import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFile, writeFile, unlink, stat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

// Zod schemas for validation
export const CredentialTypeSchema = z.enum(['api_key', 'oauth_token', 'password', 'certificate']);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

export const CredentialSchema = z.object({
  id: z.string(),
  service: z.string(),
  type: CredentialTypeSchema,
  encryptedValue: z.string(),
  createdAt: z.string(), // ISO date string for JSON serialization
  updatedAt: z.string(),
});

export type Credential = z.infer<typeof CredentialSchema>;

export const VaultStoreSchema = z.object({
  version: z.literal(1),
  credentials: z.array(CredentialSchema),
});

export type VaultStore = z.infer<typeof VaultStoreSchema>;

// Encryption result type for internal use
export interface EncryptionResult {
  iv: string;
  ciphertext: string;
  tag: string;
}

/**
 * Generate a credential reference ID in the format: cred_{service}_{type}_{first4charsOfHash}
 */
export function generateCredentialId(service: string, type: string): string {
  const random = randomBytes(8).toString('hex');
  const hash = createHash('sha256')
    .update(`${service}:${type}:${Date.now()}:${random}`)
    .digest('hex')
    .slice(0, 4);
  return `cred_${service}_${type}_${hash}`;
}

/**
 * Parse a credential ID back into its components
 * Format: cred_{service}_{type}_{hash4}
 * Note: service is alphanumeric, type may contain underscore (e.g., api_key)
 */
export function parseCredentialId(id: string): { service: string; type: string; hash: string } | null {
  // Match: cred_<service>_<type>_<4-char-hex>
  // The type can contain underscores (api_key, oauth_token), so we match greedily
  // then look for _<4-hex-chars> at the end
  const match = id.match(/^cred_([a-zA-Z0-9]+)_(.+)_([a-f0-9]{4})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return null;
  return {
    service: match[1],
    type: match[2],
    hash: match[3],
  };
}

/**
 * Generate a cryptographically secure master key
 */
export function generateMasterKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Derive a key from a password using PBKDF2
 */
export async function deriveKeyFromPassword(password: string, salt?: Buffer): Promise<{ key: Buffer; salt: Buffer }> {
  const { pbkdf2 } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const pbkdf2Async = promisify(pbkdf2);

  const actualSalt = salt ?? randomBytes(16);
  const key = await pbkdf2Async(password, actualSalt, 100000, KEY_LENGTH, 'sha256');
  return { key, salt: actualSalt };
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns base64-encoded string containing: iv || authTag || ciphertext
 */
export function encrypt(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes for AES-256-GCM`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv (12 bytes) || authTag (16 bytes) || ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Encrypt and return detailed result (for testing/advanced use)
 */
export function encryptDetailed(plaintext: string, key: Buffer): EncryptionResult {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes for AES-256-GCM`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: authTag.toString('base64'),
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * Expects base64-encoded string containing: iv || authTag || ciphertext
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes for AES-256-GCM`);
  }

  const data = Buffer.from(ciphertext, 'base64');

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Decrypt using detailed format
 */
export function decryptDetailed(encResult: EncryptionResult, key: Buffer): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes for AES-256-GCM`);
  }

  const iv = Buffer.from(encResult.iv, 'base64');
  const authTag = Buffer.from(encResult.tag, 'base64');
  const encrypted = Buffer.from(encResult.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Securely wipe a file by overwriting with random bytes before unlinking
 */
export async function secureWipe(filePath: string): Promise<void> {
  const fileStats = await stat(filePath);
  // Overwrite with random data (3 passes for thoroughness)
  for (let i = 0; i < 3; i++) {
    const randomData = randomBytes(fileStats.size);
    await writeFile(filePath, randomData);
  }
  // Finally delete the file
  await unlink(filePath);
}

/**
 * Get the default vault path (~/.openpaw/vault.json)
 */
export function getDefaultVaultPath(): string {
  return join(homedir(), '.openpaw', 'vault.json');
}

/**
 * Vault class for managing encrypted credentials
 */
export class Vault {
  private store: VaultStore;
  private key: Buffer;
  private vaultPath: string;

  constructor(key: Buffer, vaultPath?: string) {
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Key must be ${KEY_LENGTH} bytes for AES-256-GCM`);
    }
    this.key = key;
    this.vaultPath = vaultPath ?? getDefaultVaultPath();
    this.store = { version: 1, credentials: [] };
  }

  /**
   * Load vault from disk
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.vaultPath, 'utf8');
      const parsed = JSON.parse(content);
      this.store = VaultStoreSchema.parse(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, use empty store
        this.store = { version: 1, credentials: [] };
      } else {
        throw error;
      }
    }
  }

  /**
   * Save vault to disk
   */
  async save(): Promise<void> {
    const dir = dirname(this.vaultPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.vaultPath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  /**
   * Import a new credential into the vault
   */
  async import(
    service: string,
    type: CredentialType,
    value: string
  ): Promise<Credential> {
    const id = generateCredentialId(service, type);
    const now = new Date().toISOString();
    const encryptedValue = encrypt(value, this.key);

    const credential: Credential = {
      id,
      service,
      type,
      encryptedValue,
      createdAt: now,
      updatedAt: now,
    };

    this.store.credentials.push(credential);
    await this.save();

    return credential;
  }

  /**
   * List all credentials (without decrypted values)
   */
  list(): Array<Omit<Credential, 'encryptedValue'> & { encryptedValue?: never }> {
    return this.store.credentials.map(({ encryptedValue, ...rest }) => rest);
  }

  /**
   * Get a credential by ID and decrypt its value
   */
  get(id: string): { credential: Credential; value: string } | null {
    const credential = this.store.credentials.find((c) => c.id === id);
    if (!credential) return null;

    const value = decrypt(credential.encryptedValue, this.key);
    return { credential, value };
  }

  /**
   * Get credential by service and type
   */
  getByService(service: string, type?: CredentialType): { credential: Credential; value: string } | null {
    const credential = this.store.credentials.find(
      (c) => c.service === service && (type === undefined || c.type === type)
    );
    if (!credential) return null;

    const value = decrypt(credential.encryptedValue, this.key);
    return { credential, value };
  }

  /**
   * Delete a credential by ID
   */
  async delete(id: string): Promise<boolean> {
    const index = this.store.credentials.findIndex((c) => c.id === id);
    if (index === -1) return false;

    this.store.credentials.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Get the vault file path
   */
  getPath(): string {
    return this.vaultPath;
  }
}

/**
 * Create a new vault instance
 */
export async function createVault(key: Buffer, vaultPath?: string): Promise<Vault> {
  const vault = new Vault(key, vaultPath);
  await vault.load();
  return vault;
}
