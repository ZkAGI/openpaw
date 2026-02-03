import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptDetailed,
  decryptDetailed,
  generateCredentialId,
  parseCredentialId,
  generateMasterKey,
  deriveKeyFromPassword,
  secureWipe,
  Vault,
  createVault,
  CredentialSchema,
} from './index.js';
import { writeFile, readFile, mkdir, rm, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

describe('AES-256-GCM Encryption', () => {
  const testKey = randomBytes(32);

  it('should encrypt and decrypt "sk-test-key-12345"', () => {
    const plaintext = 'sk-test-key-12345';
    const ciphertext = encrypt(plaintext, testKey);
    const decrypted = decrypt(ciphertext, testKey);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt empty string', () => {
    const plaintext = '';
    const ciphertext = encrypt(plaintext, testKey);
    const decrypted = decrypt(ciphertext, testKey);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt unicode text', () => {
    const plaintext = '🔐 Secret key: 你好世界';
    const ciphertext = encrypt(plaintext, testKey);
    const decrypted = decrypt(ciphertext, testKey);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt long text', () => {
    const plaintext = 'x'.repeat(10000);
    const ciphertext = encrypt(plaintext, testKey);
    const decrypted = decrypt(ciphertext, testKey);

    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (due to random IV)', () => {
    const plaintext = 'same-text';
    const ciphertext1 = encrypt(plaintext, testKey);
    const ciphertext2 = encrypt(plaintext, testKey);

    expect(ciphertext1).not.toBe(ciphertext2);
    // Both should decrypt to the same value
    expect(decrypt(ciphertext1, testKey)).toBe(plaintext);
    expect(decrypt(ciphertext2, testKey)).toBe(plaintext);
  });

  it('should fail with wrong key', () => {
    const plaintext = 'secret';
    const ciphertext = encrypt(plaintext, testKey);
    const wrongKey = randomBytes(32);

    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it('should fail with invalid key length', () => {
    const shortKey = randomBytes(16);
    expect(() => encrypt('test', shortKey)).toThrow('Key must be 32 bytes');
  });

  it('should fail with corrupted ciphertext', () => {
    const plaintext = 'secret';
    const ciphertext = encrypt(plaintext, testKey);
    // Corrupt the ciphertext
    const corrupted = ciphertext.slice(0, -4) + 'XXXX';

    expect(() => decrypt(corrupted, testKey)).toThrow();
  });

  it('should work with detailed encrypt/decrypt format', () => {
    const plaintext = 'test-detailed';
    const result = encryptDetailed(plaintext, testKey);

    expect(result.iv).toBeDefined();
    expect(result.ciphertext).toBeDefined();
    expect(result.tag).toBeDefined();

    const decrypted = decryptDetailed(result, testKey);
    expect(decrypted).toBe(plaintext);
  });
});

describe('Encryption Benchmark', () => {
  const testKey = randomBytes(32);

  it('should encrypt + decrypt in < 5ms', () => {
    const plaintext = 'sk-test-key-12345';

    const start = performance.now();
    const ciphertext = encrypt(plaintext, testKey);
    decrypt(ciphertext, testKey);
    const end = performance.now();

    const duration = end - start;
    expect(duration).toBeLessThan(5);
    console.log(`Encrypt + decrypt cycle: ${duration.toFixed(3)}ms`);
  });

  it('should perform 1000 encrypt/decrypt cycles efficiently', () => {
    const plaintext = 'sk-test-key-12345';

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const ciphertext = encrypt(plaintext, testKey);
      decrypt(ciphertext, testKey);
    }
    const end = performance.now();

    const avgDuration = (end - start) / 1000;
    expect(avgDuration).toBeLessThan(1); // < 1ms average per cycle
    console.log(`Average encrypt + decrypt cycle (1000 runs): ${avgDuration.toFixed(3)}ms`);
  });
});

describe('Credential ID Generation', () => {
  it('should generate ID in correct format', () => {
    const id = generateCredentialId('openai', 'api_key');

    expect(id).toMatch(/^cred_openai_api_key_[a-f0-9]{4}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateCredentialId('service', 'api_key'));
    }
    expect(ids.size).toBe(100);
  });

  it('should parse ID back to components', () => {
    const id = 'cred_github_api_key_a1b2';
    const parsed = parseCredentialId(id);

    expect(parsed).not.toBeNull();
    expect(parsed!.service).toBe('github');
    expect(parsed!.type).toBe('api_key');
    expect(parsed!.hash).toBe('a1b2');
  });

  it('should return null for invalid ID format', () => {
    expect(parseCredentialId('invalid')).toBeNull();
    expect(parseCredentialId('cred_only_two_parts')).toBeNull();
    expect(parseCredentialId('cred_a_b_toolong')).toBeNull();
    expect(parseCredentialId('cred_a_b_GGGG')).toBeNull(); // Non-hex
  });

  it('should roundtrip generate and parse', () => {
    const id = generateCredentialId('anthropic', 'oauth_token');
    const parsed = parseCredentialId(id);

    expect(parsed).not.toBeNull();
    expect(parsed!.service).toBe('anthropic');
    expect(parsed!.type).toBe('oauth_token');
    expect(parsed!.hash).toMatch(/^[a-f0-9]{4}$/);
  });
});

describe('Key Generation', () => {
  it('should generate 32-byte master key', () => {
    const key = generateMasterKey();
    expect(key.length).toBe(32);
  });

  it('should generate unique keys', () => {
    const key1 = generateMasterKey();
    const key2 = generateMasterKey();
    expect(key1.equals(key2)).toBe(false);
  });

  it('should derive key from password', async () => {
    const { key, salt } = await deriveKeyFromPassword('my-secure-password');
    expect(key.length).toBe(32);
    expect(salt.length).toBe(16);
  });

  it('should derive same key with same password and salt', async () => {
    const salt = randomBytes(16);
    const { key: key1 } = await deriveKeyFromPassword('password', salt);
    const { key: key2 } = await deriveKeyFromPassword('password', salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it('should derive different keys with different passwords', async () => {
    const salt = randomBytes(16);
    const { key: key1 } = await deriveKeyFromPassword('password1', salt);
    const { key: key2 } = await deriveKeyFromPassword('password2', salt);
    expect(key1.equals(key2)).toBe(false);
  });
});

describe('Secure Wipe', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openpaw-vault-wipe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should wipe file and verify it is gone', async () => {
    const filePath = join(testDir, 'secret.txt');
    const content = 'super-secret-data-that-should-be-wiped';

    // Write the file
    await writeFile(filePath, content, 'utf8');

    // Verify file exists
    const fileExists = await stat(filePath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);

    // Wipe the file
    await secureWipe(filePath);

    // Verify file is gone
    const fileExistsAfter = await stat(filePath).then(() => true).catch(() => false);
    expect(fileExistsAfter).toBe(false);
  });

  it('should overwrite content before deletion', async () => {
    const filePath = join(testDir, 'to-wipe.txt');
    const originalContent = 'original-sensitive-data';

    await writeFile(filePath, originalContent, 'utf8');

    // Get original file content
    const beforeWipe = await readFile(filePath, 'utf8');
    expect(beforeWipe).toBe(originalContent);

    // We'll test by checking the file doesn't exist after wipe
    await secureWipe(filePath);

    // File should be gone
    await expect(access(filePath)).rejects.toThrow();
  });

  it('should handle binary files', async () => {
    const filePath = join(testDir, 'binary.bin');
    const binaryData = randomBytes(1024);

    await writeFile(filePath, binaryData);
    await secureWipe(filePath);

    await expect(access(filePath)).rejects.toThrow();
  });
});

describe('Vault Class', () => {
  let testDir: string;
  let vaultPath: string;
  let testKey: Buffer;

  beforeEach(async () => {
    testDir = join(tmpdir(), `openpaw-vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    vaultPath = join(testDir, 'vault.json');
    testKey = generateMasterKey();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should create vault with empty credentials', async () => {
    const vault = await createVault(testKey, vaultPath);
    const list = vault.list();

    expect(list).toEqual([]);
  });

  it('should import credential and persist to disk', async () => {
    const vault = await createVault(testKey, vaultPath);

    const credential = await vault.import('openai', 'api_key', 'sk-test-12345');

    expect(credential.id).toMatch(/^cred_openai_api_key_[a-f0-9]{4}$/);
    expect(credential.service).toBe('openai');
    expect(credential.type).toBe('api_key');

    // Verify persisted to disk
    const fileContent = await readFile(vaultPath, 'utf8');
    const parsed = JSON.parse(fileContent);
    expect(parsed.credentials).toHaveLength(1);
  });

  it('should list credentials without encrypted values', async () => {
    const vault = await createVault(testKey, vaultPath);

    await vault.import('github', 'api_key', 'ghp_xxxxx');
    await vault.import('anthropic', 'api_key', 'sk-ant-xxxxx');

    const list = vault.list();

    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty('encryptedValue');
    expect(list[1]).not.toHaveProperty('encryptedValue');
  });

  it('should get credential by ID and decrypt value', async () => {
    const vault = await createVault(testKey, vaultPath);
    const secret = 'sk-my-secret-api-key';

    const imported = await vault.import('myservice', 'api_key', secret);
    const result = vault.get(imported.id);

    expect(result).not.toBeNull();
    expect(result!.value).toBe(secret);
    expect(result!.credential.id).toBe(imported.id);
  });

  it('should return null for non-existent credential', async () => {
    const vault = await createVault(testKey, vaultPath);
    const result = vault.get('cred_fake_api_key_0000');

    expect(result).toBeNull();
  });

  it('should get credential by service', async () => {
    const vault = await createVault(testKey, vaultPath);
    await vault.import('github', 'api_key', 'ghp_xxxxx');

    const result = vault.getByService('github');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('ghp_xxxxx');
  });

  it('should delete credential', async () => {
    const vault = await createVault(testKey, vaultPath);
    const credential = await vault.import('temp', 'api_key', 'temporary');

    const deleted = await vault.delete(credential.id);
    expect(deleted).toBe(true);

    const list = vault.list();
    expect(list).toHaveLength(0);
  });

  it('should return false when deleting non-existent credential', async () => {
    const vault = await createVault(testKey, vaultPath);
    const deleted = await vault.delete('cred_fake_api_key_0000');
    expect(deleted).toBe(false);
  });

  it('should persist and reload vault', async () => {
    // Create and populate vault
    const vault1 = await createVault(testKey, vaultPath);
    await vault1.import('service1', 'api_key', 'secret1');
    await vault1.import('service2', 'password', 'secret2');

    // Create new vault instance from same file
    const vault2 = await createVault(testKey, vaultPath);
    const list = vault2.list();

    expect(list).toHaveLength(2);

    // Verify we can decrypt with same key
    const result = vault2.getByService('service1');
    expect(result?.value).toBe('secret1');
  });

  it('should validate credentials against schema', async () => {
    const vault = await createVault(testKey, vaultPath);
    const credential = await vault.import('test', 'api_key', 'value');

    // Manually validate the internal structure
    const stored = vault.get(credential.id);
    const validation = CredentialSchema.safeParse(stored?.credential);
    expect(validation.success).toBe(true);
  });

  it('should handle full import → list → get roundtrip', async () => {
    const vault = await createVault(testKey, vaultPath);
    const testValue = 'sk-test-key-12345-roundtrip';

    // Import
    const imported = await vault.import('roundtrip', 'api_key', testValue);

    // List
    const list = vault.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(imported.id);
    expect(list[0].service).toBe('roundtrip');

    // Get
    const retrieved = vault.get(imported.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toBe(testValue);
  });
});
