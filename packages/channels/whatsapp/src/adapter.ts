/**
 * WhatsApp Channel Adapter for OpenPaw
 *
 * Uses @whiskeysockets/baileys for WhatsApp Web multi-device protocol.
 * Sessions are stored encrypted via SecureSessionStore (tarball-at-rest pattern).
 *
 * MIGRATION PATH:
 *   ~/.openclaw/credentials/baileys/<accountId>/
 *     → encrypted into ~/.openpaw/channels/whatsapp/<accountId>.vault
 *     → decrypted to tmpfs RAM directory at runtime
 *     → Baileys reads/writes normally, never touches disk plaintext
 */

import { EventEmitter } from "node:events";
import * as crypto from "node:crypto";
import {
  SecureSessionStore,
  type SecureSessionStoreOptions,
} from "./secure-session-store.js";

// ── Channel Adapter Interface (shared across all channels) ───────────

export interface IncomingMessage {
  /** Unique message ID */
  id: string;
  /** Channel name: 'whatsapp' */
  channel: "whatsapp";
  /** Sender identifier (phone number with country code) */
  from: string;
  /** Display name of sender (if available) */
  fromName?: string | undefined;
  /** Message text content */
  text: string;
  /** Whether this is a group message */
  isGroup: boolean;
  /** Group JID (if group message) */
  groupId?: string | undefined;
  /** Original raw message (for passthrough) */
  raw: unknown;
  /** Timestamp */
  timestamp: number;
}

export interface ChannelMessage {
  /** Message text to send */
  text: string;
  /** Optional reply-to message ID */
  replyTo?: string;
}

export interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: ChannelMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  parseIncoming(raw: unknown): IncomingMessage;
  formatOutgoing(msg: ChannelMessage): unknown;
}

// ── Baileys Types (minimal, to avoid hard dependency for testing) ─────
// These match @whiskeysockets/baileys message shapes

export interface BaileysMessageKey {
  remoteJid?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
  participant?: string | null;
}

export interface BaileysMessage {
  key: BaileysMessageKey;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: {
      text?: string | null;
      contextInfo?: {
        stanzaId?: string | null;
        participant?: string | null;
        quotedMessage?: unknown;
      } | null;
    } | null;
    imageMessage?: { caption?: string | null } | null;
    videoMessage?: { caption?: string | null } | null;
    documentMessage?: { caption?: string | null } | null;
  } | null;
  messageTimestamp?: number | bigint | null;
  pushName?: string | null;
}

// ── WhatsApp Adapter ─────────────────────────────────────────────────

export interface WhatsAppAdapterConfig {
  /** Path to ~/.openpaw/channels/whatsapp/ */
  vaultDir: string;
  /** Account ID (typically phone number) */
  accountId: string;
  /** 32-byte master key from vault */
  masterKey: Buffer;
  /** Self-chat mode: only respond to own messages */
  selfChatMode?: boolean;
  /** DM policy: 'allowlist' | 'open' */
  dmPolicy?: "allowlist" | "open";
  /** Allowed sender phone numbers (with country code, e.g. '+15551234567') */
  allowFrom?: string[];
  /** Flush interval for session encryption (default: 5 min) */
  flushIntervalMs?: number;
}

export class WhatsAppAdapter extends EventEmitter implements ChannelAdapter {
  readonly name = "whatsapp";

  private config: WhatsAppAdapterConfig;
  private secureStore: SecureSessionStore;
  private socket: unknown = null; // Baileys WASocket — type kept loose for testability
  private messageHandlers: Array<(msg: IncomingMessage) => void> = [];

  constructor(config: WhatsAppAdapterConfig) {
    super();
    this.config = config;

    const storeOpts: SecureSessionStoreOptions = {
      vaultDir: config.vaultDir,
      accountId: config.accountId,
      masterKey: config.masterKey,
    };
    if (config.flushIntervalMs !== undefined) {
      storeOpts.flushIntervalMs = config.flushIntervalMs;
    }
    this.secureStore = new SecureSessionStore(storeOpts);
  }

  /**
   * Connect to WhatsApp:
   * 1. Open secure store (decrypt session to RAM)
   * 2. Create Baileys socket with authState pointing to RAM dir
   * 3. Listen for messages
   */
  async connect(): Promise<void> {
    // Step 1: Open secure store — decrypts session to tmpfs
    const sessionDir = await this.secureStore.open();

    // Step 2: Dynamic import of Baileys (may not be installed in test env)
    let makeWASocket: any;
    let useMultiFileAuthState: any;
    let DisconnectReason: any;

    try {
      const baileys = await import("@whiskeysockets/baileys");
      makeWASocket = baileys.default;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      DisconnectReason = baileys.DisconnectReason;
    } catch {
      throw new Error(
        "WhatsApp adapter requires @whiskeysockets/baileys. " +
          "Install: pnpm add @whiskeysockets/baileys"
      );
    }

    // Step 3: Create auth state from our secure RAM directory
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Step 4: Create socket
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true, // For initial pairing
      browser: ["OpenPaw", "Chrome", "1.0.0"],
    });

    // Step 5: Save credentials when they change → auto-flushed to vault
    sock.ev.on("creds.update", async () => {
      await saveCreds();
      // Trigger an early flush so the vault stays current
      await this.secureStore.flush();
    });

    // Step 6: Handle incoming messages
    sock.ev.on("messages.upsert", (upsert: { messages: BaileysMessage[]; type: string }) => {
      if (upsert.type !== "notify") return;

      for (const msg of upsert.messages) {
        // Skip non-text messages for now
        const text = this.extractText(msg);
        if (!text) continue;

        // Apply DM policy
        if (!this.isAllowed(msg)) continue;

        const incoming = this.parseIncoming(msg);
        for (const handler of this.messageHandlers) {
          handler(incoming);
        }
        this.emit("message", incoming);
      }
    });

    // Step 7: Handle disconnection with auto-reconnect
    sock.ev.on("connection.update", (update: { connection?: string; lastDisconnect?: { error?: { output?: { statusCode?: number } } } }) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;

        if (shouldReconnect) {
          console.log("[OpenPaw] WhatsApp disconnected, reconnecting...");
          this.connect();
        } else {
          console.log("[OpenPaw] WhatsApp logged out. Re-scan QR needed.");
          this.emit("loggedOut");
        }
      }

      if (connection === "open") {
        console.log("[OpenPaw] WhatsApp connected");
        this.emit("connected");
      }
    });

    this.socket = sock;
  }

  /**
   * Disconnect: close socket, flush and encrypt session, wipe RAM
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      try {
        (this.socket as any).end?.();
      } catch {
        // Socket may already be closed
      }
      this.socket = null;
    }

    await this.secureStore.close();
  }

  /**
   * Send a message to a WhatsApp JID
   */
  async send(to: string, message: ChannelMessage): Promise<void> {
    if (!this.socket) {
      throw new Error("WhatsApp not connected. Call connect() first.");
    }

    const jid = this.normalizeJid(to);
    const formatted = this.formatOutgoing(message);

    await (this.socket as any).sendMessage(jid, formatted);
  }

  /**
   * Register a message handler
   */
  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Parse a raw Baileys message into our IncomingMessage format
   */
  parseIncoming(raw: unknown): IncomingMessage {
    const msg = raw as BaileysMessage;
    const jid = msg.key.remoteJid ?? "";
    const isGroup = jid.endsWith("@g.us");

    return {
      id: msg.key.id ?? crypto.randomUUID(),
      channel: "whatsapp",
      from: isGroup
        ? (msg.key.participant ?? jid)
        : jid.replace("@s.whatsapp.net", ""),
      fromName: msg.pushName ?? undefined,
      text: this.extractText(msg) ?? "",
      isGroup,
      groupId: isGroup ? jid : undefined,
      raw: msg,
      timestamp:
        typeof msg.messageTimestamp === "bigint"
          ? Number(msg.messageTimestamp)
          : typeof msg.messageTimestamp === "number"
            ? msg.messageTimestamp
            : Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Format a ChannelMessage into Baileys sendMessage format
   */
  formatOutgoing(msg: ChannelMessage): Record<string, unknown> {
    const result: Record<string, unknown> = { text: msg.text };

    if (msg.replyTo) {
      result["quoted"] = { key: { id: msg.replyTo } };
    }

    return result;
  }

  /**
   * Get the SecureSessionStore for testing and external flush control
   */
  getSecureStore(): SecureSessionStore {
    return this.secureStore;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private extractText(msg: BaileysMessage): string | null {
    if (!msg.message) return null;

    return (
      msg.message.conversation ??
      msg.message.extendedTextMessage?.text ??
      msg.message.imageMessage?.caption ??
      msg.message.videoMessage?.caption ??
      msg.message.documentMessage?.caption ??
      null
    );
  }

  private isAllowed(msg: BaileysMessage): boolean {
    // Skip own messages unless selfChatMode
    if (msg.key.fromMe) {
      return this.config.selfChatMode ?? false;
    }

    // Apply DM policy
    if (this.config.dmPolicy === "allowlist") {
      const sender =
        msg.key.participant ??
        msg.key.remoteJid?.replace("@s.whatsapp.net", "") ??
        "";

      const allowed = this.config.allowFrom ?? [];
      return allowed.some(
        (num) => sender.includes(num.replace("+", ""))
      );
    }

    return true; // 'open' policy
  }

  private normalizeJid(input: string): string {
    // Already a JID
    if (input.includes("@")) return input;

    // Phone number → JID
    const cleaned = input.replace(/[^0-9]/g, "");
    return `${cleaned}@s.whatsapp.net`;
  }
}

// ── Migration helper for CLI ─────────────────────────────────────────

/**
 * Migrate WhatsApp session from OpenClaw to OpenPaw
 * Called by: openpaw migrate --from openclaw
 */
export async function migrateWhatsAppSession(opts: {
  openclawDir: string;
  openpawDir: string;
  masterKey: Buffer;
  wipeOriginal?: boolean;
}): Promise<{
  found: boolean;
  fileCount: number;
  accountId: string;
  vaultPath: string;
}> {
  const vaultDir = `${opts.openpawDir}/channels/whatsapp`;
  const fs = await import("node:fs");

  // Discover account IDs
  const baileysBase = `${opts.openclawDir}/credentials/baileys`;

  if (!fs.existsSync(baileysBase)) {
    return { found: false, fileCount: 0, accountId: "", vaultPath: "" };
  }

  const accounts = fs
    .readdirSync(baileysBase)
    .filter((d: string) =>
      fs.statSync(`${baileysBase}/${d}`).isDirectory()
    );

  if (accounts.length === 0) {
    return { found: false, fileCount: 0, accountId: "", vaultPath: "" };
  }

  // Migrate each account
  let totalFiles = 0;
  let lastVaultPath = "";

  for (const accountId of accounts) {
    const store = new SecureSessionStore({
      vaultDir,
      accountId,
      masterKey: opts.masterKey,
      flushIntervalMs: 0, // No auto-flush during migration
    });

    const migrateOpts = opts.wipeOriginal !== undefined ? { wipeOriginal: opts.wipeOriginal } : undefined;
    const result = await store.migrateFromOpenClaw(opts.openclawDir, migrateOpts);

    totalFiles += result.fileCount;
    lastVaultPath = result.vaultPath;
  }

  return {
    found: true,
    fileCount: totalFiles,
    accountId: accounts[0] ?? "",
    vaultPath: lastVaultPath,
  };
}
