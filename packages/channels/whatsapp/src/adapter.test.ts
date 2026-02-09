/**
 * WhatsApp Adapter Tests
 *
 * Tests parseIncoming/formatOutgoing with REAL Baileys message fixtures.
 * No mocks. These are actual message shapes from the WhatsApp protocol.
 */

import { describe, it, expect } from "vitest";
import { WhatsAppAdapter, type BaileysMessage } from "./adapter.js";
import * as crypto from "node:crypto";

// ── Real Baileys Message Fixtures ────────────────────────────────────
// These match the actual shapes from @whiskeysockets/baileys

const FIXTURES = {
  /** Simple text DM */
  textDM: {
    key: {
      remoteJid: "15551234567@s.whatsapp.net",
      fromMe: false,
      id: "3EB0B430A2B0F6D913",
      participant: null,
    },
    message: {
      conversation: "Hello, show me my API credentials",
    },
    messageTimestamp: 1707500000,
    pushName: "Alice",
  } satisfies BaileysMessage,

  /** Extended text (reply) */
  replyMessage: {
    key: {
      remoteJid: "15559876543@s.whatsapp.net",
      fromMe: false,
      id: "3EB0C741B3D1E7E024",
      participant: null,
    },
    message: {
      extendedTextMessage: {
        text: "Yes, deploy to production",
        contextInfo: {
          stanzaId: "3EB0B430A2B0F6D913",
          participant: "15551234567@s.whatsapp.net",
          quotedMessage: { conversation: "Should I deploy?" },
        },
      },
    },
    messageTimestamp: 1707500100,
    pushName: "Bob",
  } satisfies BaileysMessage,

  /** Group message */
  groupMessage: {
    key: {
      remoteJid: "120363123456789012@g.us",
      fromMe: false,
      id: "3EB0D852C4E2F8F135",
      participant: "15551234567@s.whatsapp.net",
    },
    message: {
      conversation: "Check the deployment status",
    },
    messageTimestamp: 1707500200,
    pushName: "Alice",
  } satisfies BaileysMessage,

  /** Image with caption */
  imageWithCaption: {
    key: {
      remoteJid: "15551234567@s.whatsapp.net",
      fromMe: false,
      id: "3EB0E963D5F3A9A246",
      participant: null,
    },
    message: {
      imageMessage: {
        caption: "Here's the error screenshot",
      },
    },
    messageTimestamp: 1707500300,
    pushName: "Alice",
  } satisfies BaileysMessage,

  /** Own message (self-chat mode) */
  ownMessage: {
    key: {
      remoteJid: "15550001111@s.whatsapp.net",
      fromMe: true,
      id: "3EB0FA74E6G4BAB357",
      participant: null,
    },
    message: {
      conversation: "Remind me to check server logs",
    },
    messageTimestamp: 1707500400,
    pushName: "Me",
  } satisfies BaileysMessage,

  /** Message with no text (media only, no caption) */
  mediaNoCaption: {
    key: {
      remoteJid: "15551234567@s.whatsapp.net",
      fromMe: false,
      id: "3EB0AB85F7H5CBC468",
      participant: null,
    },
    message: {
      imageMessage: {
        caption: null,
      },
    },
    messageTimestamp: 1707500500,
    pushName: "Alice",
  } satisfies BaileysMessage,

  /** bigint timestamp (some Baileys versions use this) */
  bigintTimestamp: {
    key: {
      remoteJid: "15551234567@s.whatsapp.net",
      fromMe: false,
      id: "3EB0BC96G8I6DCD579",
      participant: null,
    },
    message: {
      conversation: "Test bigint timestamp",
    },
    messageTimestamp: BigInt(1707500600),
    pushName: "Alice",
  } satisfies BaileysMessage,
};

// ── Helper to create adapter (without connecting) ────────────────────

function createTestAdapter(overrides?: Partial<{ selfChatMode: boolean; dmPolicy: "allowlist" | "open"; allowFrom: string[] }>) {
  return new WhatsAppAdapter({
    vaultDir: "/tmp/test-vault",
    accountId: "test",
    masterKey: crypto.randomBytes(32),
    selfChatMode: overrides?.selfChatMode ?? false,
    dmPolicy: overrides?.dmPolicy ?? "open",
    allowFrom: overrides?.allowFrom ?? [],
    flushIntervalMs: 0,
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("WhatsAppAdapter.parseIncoming", () => {
  it("parses a simple text DM", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.textDM);

    expect(result.id).toBe("3EB0B430A2B0F6D913");
    expect(result.channel).toBe("whatsapp");
    expect(result.from).toBe("15551234567");
    expect(result.fromName).toBe("Alice");
    expect(result.text).toBe("Hello, show me my API credentials");
    expect(result.isGroup).toBe(false);
    expect(result.groupId).toBeUndefined();
    expect(result.timestamp).toBe(1707500000);
  });

  it("parses an extended text (reply) message", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.replyMessage);

    expect(result.text).toBe("Yes, deploy to production");
    expect(result.from).toBe("15559876543");
    expect(result.fromName).toBe("Bob");
  });

  it("parses a group message correctly", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.groupMessage);

    expect(result.isGroup).toBe(true);
    expect(result.groupId).toBe("120363123456789012@g.us");
    // In groups, 'from' should be the participant, not the group JID
    expect(result.from).toBe("15551234567@s.whatsapp.net");
    expect(result.text).toBe("Check the deployment status");
  });

  it("parses image with caption", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.imageWithCaption);

    expect(result.text).toBe("Here's the error screenshot");
  });

  it("handles bigint timestamps", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.bigintTimestamp);

    expect(result.timestamp).toBe(1707500600);
    expect(typeof result.timestamp).toBe("number");
  });

  it("preserves raw message for passthrough", () => {
    const adapter = createTestAdapter();
    const result = adapter.parseIncoming(FIXTURES.textDM);

    expect(result.raw).toBe(FIXTURES.textDM);
  });
});

describe("WhatsAppAdapter.formatOutgoing", () => {
  it("formats a simple text message", () => {
    const adapter = createTestAdapter();
    const result = adapter.formatOutgoing({ text: "Hello from OpenPaw!" });

    expect(result).toEqual({ text: "Hello from OpenPaw!" });
  });

  it("formats a reply message with quoted reference", () => {
    const adapter = createTestAdapter();
    const result = adapter.formatOutgoing({
      text: "Got it, deploying now",
      replyTo: "3EB0B430A2B0F6D913",
    });

    expect(result).toEqual({
      text: "Got it, deploying now",
      quoted: { key: { id: "3EB0B430A2B0F6D913" } },
    });
  });
});

describe("WhatsAppAdapter interface compliance", () => {
  it("implements ChannelAdapter interface", () => {
    const adapter = createTestAdapter();

    expect(adapter.name).toBe("whatsapp");
    expect(typeof adapter.connect).toBe("function");
    expect(typeof adapter.disconnect).toBe("function");
    expect(typeof adapter.send).toBe("function");
    expect(typeof adapter.onMessage).toBe("function");
    expect(typeof adapter.parseIncoming).toBe("function");
    expect(typeof adapter.formatOutgoing).toBe("function");
  });

  it("provides access to secure store", () => {
    const adapter = createTestAdapter();
    const store = adapter.getSecureStore();
    expect(store).toBeDefined();
    expect(store.isOpen).toBe(false);
  });
});

describe("WhatsAppAdapter migration", () => {
  it("migrateWhatsAppSession returns found:false when no session exists", async () => {
    const { migrateWhatsAppSession } = await import("./adapter.js");
    const result = await migrateWhatsAppSession({
      openclawDir: "/nonexistent/path",
      openpawDir: "/tmp/openpaw-test",
      masterKey: crypto.randomBytes(32),
    });

    expect(result.found).toBe(false);
    expect(result.fileCount).toBe(0);
    expect(result.accountId).toBe("");
  });
});
