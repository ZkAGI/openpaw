/**
 * SecureSessionStore Tests
 *
 * ALL tests use real crypto, real files, real I/O.
 * No mocks. No stubs. Every test creates real temp directories,
 * encrypts real data, and verifies real decryption.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SecureSessionStore } from "./secure-session-store.js";

// ── Test Helpers ─────────────────────────────────────────────────────

function generateMasterKey(): Buffer {
  return crypto.randomBytes(32);
}

async function createTempDir(prefix: string): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Create a realistic Baileys session directory */
async function createFakeBaileysSession(dir: string): Promise<string[]> {
  await fsp.mkdir(dir, { recursive: true });

  const files: Record<string, string> = {
    "creds.json": JSON.stringify({
      noiseKey: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") },
      pairingEphemeralKeyPair: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") },
      signedIdentityKey: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") },
      signedPreKey: { keyPair: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") }, signature: crypto.randomBytes(64).toString("base64"), keyId: 1 },
      registrationId: 12345,
      advSecretKey: crypto.randomBytes(32).toString("base64"),
      me: { id: "15551234567:42@s.whatsapp.net", name: "Test User" },
      account: { details: crypto.randomBytes(128).toString("base64"), accountSignatureKey: crypto.randomBytes(32).toString("base64"), accountSignature: crypto.randomBytes(64).toString("base64"), deviceSignature: crypto.randomBytes(64).toString("base64") },
    }, null, 2),
    "app-state-sync-key-AAAAAQ.json": JSON.stringify({
      keyData: crypto.randomBytes(64).toString("base64"),
      fingerprint: { rawId: 12345, currentIndex: 1, deviceIndexes: [0] },
      timestamp: Date.now(),
    }),
    "pre-key-1.json": JSON.stringify({
      keyPair: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") },
      keyId: 1,
    }),
    "pre-key-2.json": JSON.stringify({
      keyPair: { private: crypto.randomBytes(32).toString("base64"), public: crypto.randomBytes(32).toString("base64") },
      keyId: 2,
    }),
    "sender-key-memory-abcdef.json": JSON.stringify({
      "group123@g.us": { senderKeyId: 42 },
    }),
  };

  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content);
  }

  return Object.keys(files);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("SecureSessionStore", () => {
  let tmpDir: string;
  let vaultDir: string;
  let masterKey: Buffer;

  beforeEach(async () => {
    tmpDir = await createTempDir("openpaw-test-");
    vaultDir = path.join(tmpDir, "vault");
    masterKey = generateMasterKey();
  });

  afterEach(async () => {
    // Cleanup
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Constructor ──────────────────────────────────────────────────

  it("throws on invalid master key length", () => {
    expect(() => {
      new SecureSessionStore({
        vaultDir,
        accountId: "test",
        masterKey: Buffer.from("too-short"),
      });
    }).toThrow("Master key must be 32 bytes");
  });

  it("accepts 32-byte master key", () => {
    const store = new SecureSessionStore({
      vaultDir,
      accountId: "test",
      masterKey,
    });
    expect(store.isOpen).toBe(false);
  });

  // ── Open (fresh, no existing vault) ──────────────────────────────

  it("opens with empty vault (first time use)", async () => {
    const store = new SecureSessionStore({
      vaultDir,
      accountId: "fresh-account",
      masterKey,
      flushIntervalMs: 0, // Disable auto-flush for testing
    });

    const sessionDir = await store.open();

    expect(store.isOpen).toBe(true);
    expect(fs.existsSync(sessionDir)).toBe(true);
    expect(sessionDir).toContain("openpaw-wa-fresh-account-");

    // Directory should be empty (no previous session)
    const files = await fsp.readdir(sessionDir);
    expect(files.length).toBe(0);

    await store.close();
  });

  // ── Import from plaintext ────────────────────────────────────────

  it("imports a plaintext Baileys session and creates vault file", async () => {
    const sourceDir = path.join(tmpDir, "baileys-source");
    const fileNames = await createFakeBaileysSession(sourceDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "import-test",
      masterKey,
      flushIntervalMs: 0,
    });

    const result = await store.importFromPlaintext(sourceDir);

    expect(result.fileCount).toBe(fileNames.length);
    expect(fs.existsSync(result.vaultPath)).toBe(true);

    // Vault file should be encrypted JSON
    const vaultData = JSON.parse(fs.readFileSync(result.vaultPath, "utf-8"));
    expect(vaultData.iv).toBeDefined();
    expect(vaultData.ciphertext).toBeDefined();
    expect(vaultData.tag).toBeDefined();
    expect(vaultData.version).toBe(1);

    // Ciphertext should NOT contain any plaintext from the original files
    const ciphertextHex = vaultData.ciphertext;
    expect(ciphertextHex).not.toContain("noiseKey");
    expect(ciphertextHex).not.toContain("whatsapp.net");
  });

  // ── Full lifecycle: import → open → read → close → reopen ───────

  it("full lifecycle: import, open, verify files, close, reopen, verify again", async () => {
    const sourceDir = path.join(tmpDir, "baileys-lifecycle");
    await createFakeBaileysSession(sourceDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "lifecycle",
      masterKey,
      flushIntervalMs: 0,
    });

    // Import
    await store.importFromPlaintext(sourceDir);

    // Open — should decrypt to RAM
    const sessionDir = await store.open();
    const filesInRam = await fsp.readdir(sessionDir);
    expect(filesInRam.length).toBe(5);
    expect(filesInRam).toContain("creds.json");
    expect(filesInRam).toContain("pre-key-1.json");

    // Verify creds.json is readable plaintext in RAM
    const creds = JSON.parse(
      await fsp.readFile(path.join(sessionDir, "creds.json"), "utf-8")
    );
    expect(creds.registrationId).toBe(12345);
    expect(creds.me.id).toContain("whatsapp.net");

    // Close — should encrypt back and wipe RAM
    await store.close();
    expect(store.isOpen).toBe(false);

    // RAM directory should be gone
    expect(fs.existsSync(sessionDir)).toBe(false);

    // Vault file should still exist
    expect(fs.existsSync(path.join(vaultDir, "lifecycle.vault"))).toBe(true);

    // Reopen with SAME key — should decrypt successfully
    const store2 = new SecureSessionStore({
      vaultDir,
      accountId: "lifecycle",
      masterKey,
      flushIntervalMs: 0,
    });

    const sessionDir2 = await store2.open();
    const filesInRam2 = await fsp.readdir(sessionDir2);
    expect(filesInRam2.length).toBe(5);

    // Verify data integrity
    const creds2 = JSON.parse(
      await fsp.readFile(path.join(sessionDir2, "creds.json"), "utf-8")
    );
    expect(creds2.registrationId).toBe(12345);

    await store2.close();
  });

  // ── Wrong key cannot decrypt ─────────────────────────────────────

  it("fails to open with wrong master key", async () => {
    const sourceDir = path.join(tmpDir, "baileys-wrongkey");
    await createFakeBaileysSession(sourceDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "wrongkey",
      masterKey,
      flushIntervalMs: 0,
    });

    await store.importFromPlaintext(sourceDir);

    // Try to open with different key
    const wrongKey = generateMasterKey();
    const store2 = new SecureSessionStore({
      vaultDir,
      accountId: "wrongkey",
      masterKey: wrongKey,
      flushIntervalMs: 0,
    });

    await expect(store2.open()).rejects.toThrow();
  });

  // ── Flush persists in-flight changes ─────────────────────────────

  it("flush persists files written to RAM after open", async () => {
    const sourceDir = path.join(tmpDir, "baileys-flush");
    await createFakeBaileysSession(sourceDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "flush-test",
      masterKey,
      flushIntervalMs: 0,
    });

    await store.importFromPlaintext(sourceDir);
    const sessionDir = await store.open();

    // Simulate Baileys writing a new file (key ratcheting)
    const newKeyData = JSON.stringify({
      keyPair: {
        private: crypto.randomBytes(32).toString("base64"),
        public: crypto.randomBytes(32).toString("base64"),
      },
      keyId: 99,
    });
    await fsp.writeFile(
      path.join(sessionDir, "pre-key-99.json"),
      newKeyData
    );

    // Verify 6 files now in RAM
    const filesBeforeFlush = await fsp.readdir(sessionDir);
    expect(filesBeforeFlush.length).toBe(6);

    // Flush (re-encrypt to disk)
    await store.flush();
    await store.close();

    // Reopen — the new file should be there
    const store2 = new SecureSessionStore({
      vaultDir,
      accountId: "flush-test",
      masterKey,
      flushIntervalMs: 0,
    });

    const sessionDir2 = await store2.open();
    const filesAfterReopen = await fsp.readdir(sessionDir2);
    expect(filesAfterReopen.length).toBe(6);
    expect(filesAfterReopen).toContain("pre-key-99.json");

    // Verify the new key data
    const restoredKey = JSON.parse(
      await fsp.readFile(path.join(sessionDir2, "pre-key-99.json"), "utf-8")
    );
    expect(restoredKey.keyId).toBe(99);

    await store2.close();
  });

  // ── Migration from OpenClaw ──────────────────────────────────────

  it("migrates from OpenClaw directory structure", async () => {
    // Create fake OpenClaw directory
    const openclawDir = path.join(tmpDir, ".openclaw");
    const baileysDir = path.join(
      openclawDir,
      "credentials",
      "baileys",
      "15551234567"
    );
    await createFakeBaileysSession(baileysDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "15551234567",
      masterKey,
      flushIntervalMs: 0,
    });

    const result = await store.migrateFromOpenClaw(openclawDir);

    expect(result.found).toBe(true);
    expect(result.fileCount).toBe(5);
    expect(result.sourcePath).toContain("baileys/15551234567");
    expect(fs.existsSync(result.vaultPath)).toBe(true);

    // Original files should still exist (wipeOriginal was false)
    expect(fs.existsSync(baileysDir)).toBe(true);
  });

  it("migrates from OpenClaw with secure wipe", async () => {
    const openclawDir = path.join(tmpDir, ".openclaw-wipe");
    const baileysDir = path.join(
      openclawDir,
      "credentials",
      "baileys",
      "15559876543"
    );
    await createFakeBaileysSession(baileysDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "15559876543",
      masterKey,
      flushIntervalMs: 0,
    });

    const result = await store.migrateFromOpenClaw(openclawDir, {
      wipeOriginal: true,
    });

    expect(result.found).toBe(true);
    expect(result.fileCount).toBe(5);

    // Original directory should be gone (securely wiped)
    expect(fs.existsSync(baileysDir)).toBe(false);

    // But vault file should exist and be usable
    const sessionDir = await store.open();
    const files = await fsp.readdir(sessionDir);
    expect(files.length).toBe(5);
    expect(files).toContain("creds.json");

    await store.close();
  });

  it("returns found:false when no Baileys session exists", async () => {
    const emptyDir = path.join(tmpDir, ".openclaw-empty");
    await fsp.mkdir(emptyDir, { recursive: true });

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "noaccount",
      masterKey,
      flushIntervalMs: 0,
    });

    const result = await store.migrateFromOpenClaw(emptyDir);
    expect(result.found).toBe(false);
    expect(result.fileCount).toBe(0);
  });

  // ── Performance ──────────────────────────────────────────────────

  it("encrypts and decrypts 5 Baileys session files in < 50ms", async () => {
    const sourceDir = path.join(tmpDir, "baileys-perf");
    await createFakeBaileysSession(sourceDir);

    const store = new SecureSessionStore({
      vaultDir,
      accountId: "perf",
      masterKey,
      flushIntervalMs: 0,
    });

    // Import (encrypt)
    const importStart = performance.now();
    await store.importFromPlaintext(sourceDir);
    const importTime = performance.now() - importStart;

    // Open (decrypt)
    const openStart = performance.now();
    await store.open();
    const openTime = performance.now() - openStart;

    expect(importTime).toBeLessThan(50);
    expect(openTime).toBeLessThan(50);

    await store.close();
  });
});
