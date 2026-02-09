/**
 * SecureSessionStore — "Tarball at rest" pattern for WhatsApp Baileys sessions
 *
 * HOW IT WORKS:
 * ┌──────────────────────────────────────────────────────────────┐
 * │ ON DISK (encrypted):                                         │
 * │   ~/.openpaw/channels/whatsapp/<accountId>.vault              │
 * │   → Single AES-256-GCM encrypted file                       │
 * │   → Contains tar.gz of entire baileys auth directory         │
 * │                                                              │
 * │ IN RAM (decrypted, only while running):                      │
 * │   /tmp/openpaw-wa-<random>/                                  │
 * │   ├── creds.json                                             │
 * │   ├── app-state-sync-key-*.json                              │
 * │   ├── pre-key-*.json                                         │
 * │   └── sender-key-memory-*.json                               │
 * │                                                              │
 * │ Baileys reads/writes to RAM path normally.                   │
 * │ Periodic flush: re-encrypt RAM → disk every N minutes.       │
 * │ On stop: final flush + wipe RAM directory.                   │
 * └──────────────────────────────────────────────────────────────┘
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// ── Minimal tar implementation (no external dependency) ──────────────
// We pack/unpack a flat directory of JSON files. No need for full tar.
// Format: [4-byte name length][name][4-byte data length][data] repeated

function packDirectory(dirPath: string): Buffer {
  const files = fs.readdirSync(dirPath);
  const chunks: Buffer[] = [];

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) continue;

    const data = fs.readFileSync(filePath);
    const nameBuffer = Buffer.from(file, "utf-8");

    // 4 bytes name length + name + 4 bytes data length + data
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32BE(nameBuffer.length, 0);

    const dataLen = Buffer.alloc(4);
    dataLen.writeUInt32BE(data.length, 0);

    chunks.push(nameLen, nameBuffer, dataLen, data);
  }

  return Buffer.concat(chunks);
}

function unpackToDirectory(packed: Buffer, dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });

  let offset = 0;
  while (offset < packed.length) {
    // Read name
    if (offset + 4 > packed.length) break;
    const nameLen = packed.readUInt32BE(offset);
    offset += 4;

    if (offset + nameLen > packed.length) break;
    const name = packed.subarray(offset, offset + nameLen).toString("utf-8");
    offset += nameLen;

    // Read data
    if (offset + 4 > packed.length) break;
    const dataLen = packed.readUInt32BE(offset);
    offset += 4;

    if (offset + dataLen > packed.length) break;
    const data = packed.subarray(offset, offset + dataLen);
    offset += dataLen;

    // Sanitize filename (prevent path traversal)
    const safeName = path.basename(name);
    if (safeName !== name || safeName.startsWith(".")) {
      continue; // Skip suspicious filenames
    }

    fs.writeFileSync(path.join(dirPath, safeName), data);
  }
}

// ── Encryption (matches existing vault AES-256-GCM) ──────────────────

interface EncryptedBlob {
  iv: string; // hex
  ciphertext: string; // hex
  tag: string; // hex
  version: 1;
}

function encrypt(plaintext: Buffer, masterKey: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  return {
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    version: 1,
  };
}

function decrypt(blob: EncryptedBlob, masterKey: Buffer): Buffer {
  const iv = Buffer.from(blob.iv, "hex");
  const ciphertext = Buffer.from(blob.ciphertext, "hex");
  const tag = Buffer.from(blob.tag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ── SecureSessionStore ───────────────────────────────────────────────

export interface SecureSessionStoreOptions {
  /** Path to ~/.openpaw/channels/whatsapp/ */
  vaultDir: string;
  /** Account identifier (phone number or Baileys account ID) */
  accountId: string;
  /** 32-byte master key (from OpenPaw vault) */
  masterKey: Buffer;
  /** Flush interval in ms (default: 5 minutes) */
  flushIntervalMs?: number;
  /** Custom tmp base dir (default: os.tmpdir()) */
  tmpBase?: string;
}

export class SecureSessionStore {
  private vaultDir: string;
  private accountId: string;
  private masterKey: Buffer;
  private flushIntervalMs: number;
  private tmpBase: string;

  /** The RAM directory where Baileys reads/writes */
  private ramDir: string | null = null;
  /** Interval handle for periodic flush */
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether the store is currently open */
  private _isOpen = false;

  constructor(opts: SecureSessionStoreOptions) {
    this.vaultDir = opts.vaultDir;
    this.accountId = opts.accountId;
    this.masterKey = opts.masterKey;
    this.flushIntervalMs = opts.flushIntervalMs ?? 5 * 60 * 1000; // 5 min
    this.tmpBase = opts.tmpBase ?? os.tmpdir();

    // Validate master key
    if (this.masterKey.length !== 32) {
      throw new Error(
        `Master key must be 32 bytes, got ${this.masterKey.length}`
      );
    }
  }

  /** The path Baileys should use for its authState */
  get sessionDir(): string {
    if (!this.ramDir) {
      throw new Error("SecureSessionStore not opened. Call open() first.");
    }
    return this.ramDir;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Path to the encrypted vault file on disk */
  private get vaultFilePath(): string {
    return path.join(this.vaultDir, `${this.accountId}.vault`);
  }

  /**
   * Open the secure store:
   * 1. Create RAM directory
   * 2. If vault file exists, decrypt and extract to RAM
   * 3. Start periodic flush timer
   */
  async open(): Promise<string> {
    if (this._isOpen) return this.ramDir!;

    // Create RAM directory with restrictive permissions
    this.ramDir = await fsp.mkdtemp(
      path.join(this.tmpBase, `openpaw-wa-${this.accountId}-`)
    );
    await fsp.chmod(this.ramDir, 0o700);

    // If vault file exists, decrypt and unpack
    if (fs.existsSync(this.vaultFilePath)) {
      const vaultData = await fsp.readFile(this.vaultFilePath, "utf-8");
      const blob: EncryptedBlob = JSON.parse(vaultData);

      // Decrypt → decompress → unpack
      const compressed = decrypt(blob, this.masterKey);
      const packed = await gunzip(compressed);
      unpackToDirectory(packed, this.ramDir);
    }

    // Start periodic flush
    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => {
        this.flush().catch((err) => {
          console.error("[OpenPaw] WhatsApp session flush error:", err.message);
        });
      }, this.flushIntervalMs);

      // Don't block Node.js exit
      if (this.flushTimer.unref) {
        this.flushTimer.unref();
      }
    }

    this._isOpen = true;
    return this.ramDir;
  }

  /**
   * Flush: re-encrypt RAM contents to disk
   * Called periodically and on close()
   */
  async flush(): Promise<void> {
    if (!this.ramDir || !this._isOpen) return;

    // Check if RAM dir still exists (could be wiped externally)
    if (!fs.existsSync(this.ramDir)) return;

    // Pack → compress → encrypt → write
    const packed = packDirectory(this.ramDir);
    const compressed = await gzip(packed);
    const blob = encrypt(compressed, this.masterKey);

    // Ensure vault directory exists
    await fsp.mkdir(this.vaultDir, { recursive: true });

    // Atomic write: write to .tmp then rename
    const tmpPath = this.vaultFilePath + ".tmp";
    await fsp.writeFile(tmpPath, JSON.stringify(blob), "utf-8");
    await fsp.rename(tmpPath, this.vaultFilePath);
  }

  /**
   * Close the secure store:
   * 1. Stop flush timer
   * 2. Final flush to disk
   * 3. Secure-wipe RAM directory
   */
  async close(): Promise<void> {
    if (!this._isOpen) return;

    // Stop timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();

    // Secure-wipe RAM directory
    if (this.ramDir && fs.existsSync(this.ramDir)) {
      await this.secureWipeDir(this.ramDir);
    }

    this.ramDir = null;
    this._isOpen = false;
  }

  /**
   * Import: copy an existing plaintext Baileys directory into the vault
   * Used during migration from OpenClaw
   */
  async importFromPlaintext(sourceDir: string): Promise<{
    fileCount: number;
    vaultPath: string;
  }> {
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory not found: ${sourceDir}`);
    }

    const files = fs.readdirSync(sourceDir).filter((f) => {
      const stat = fs.statSync(path.join(sourceDir, f));
      return stat.isFile();
    });

    if (files.length === 0) {
      throw new Error(`No files found in: ${sourceDir}`);
    }

    // Pack → compress → encrypt → write
    const packed = packDirectory(sourceDir);
    const compressed = await gzip(packed);
    const blob = encrypt(compressed, this.masterKey);

    await fsp.mkdir(this.vaultDir, { recursive: true });
    await fsp.writeFile(this.vaultFilePath, JSON.stringify(blob), "utf-8");

    return {
      fileCount: files.length,
      vaultPath: this.vaultFilePath,
    };
  }

  /**
   * Migrate from OpenClaw: finds baileys session, imports, optionally wipes original
   */
  async migrateFromOpenClaw(
    openclawDir: string,
    opts?: { wipeOriginal?: boolean }
  ): Promise<{
    found: boolean;
    fileCount: number;
    sourcePath: string;
    vaultPath: string;
  }> {
    // OpenClaw stores Baileys sessions at:
    // ~/.openclaw/credentials/baileys/<accountId>/
    const baileysBase = path.join(openclawDir, "credentials", "baileys");

    if (!fs.existsSync(baileysBase)) {
      return {
        found: false,
        fileCount: 0,
        sourcePath: baileysBase,
        vaultPath: this.vaultFilePath,
      };
    }

    // Find the account directory
    const accounts = fs
      .readdirSync(baileysBase)
      .filter((d) =>
        fs.statSync(path.join(baileysBase, d)).isDirectory()
      );

    if (accounts.length === 0) {
      return {
        found: false,
        fileCount: 0,
        sourcePath: baileysBase,
        vaultPath: this.vaultFilePath,
      };
    }

    // Use first account (or the one matching our accountId)
    const targetAccount =
      accounts.find((a) => a === this.accountId) ?? accounts[0] ?? "";
    if (!targetAccount) {
      return {
        found: false,
        fileCount: 0,
        sourcePath: baileysBase,
        vaultPath: this.vaultFilePath,
      };
    }
    const sourceDir = path.join(baileysBase, targetAccount);

    const result = await this.importFromPlaintext(sourceDir);

    // Optionally secure-wipe the original
    if (opts?.wipeOriginal) {
      await this.secureWipeDir(sourceDir);
    }

    return {
      found: true,
      fileCount: result.fileCount,
      sourcePath: sourceDir,
      vaultPath: result.vaultPath,
    };
  }

  /**
   * Secure wipe: overwrite all files with random bytes, then delete
   */
  private async secureWipeDir(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    const entries = await fsp.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.secureWipeDir(fullPath);
      } else if (entry.isFile()) {
        // 3-pass overwrite with random bytes
        const stat = await fsp.stat(fullPath);
        for (let pass = 0; pass < 3; pass++) {
          const randomData = crypto.randomBytes(stat.size || 64);
          await fsp.writeFile(fullPath, randomData);
        }
        await fsp.unlink(fullPath);
      }
    }

    await fsp.rmdir(dirPath);
  }
}
