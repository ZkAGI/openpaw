import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { z } from 'zod';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export const CredentialSchema = z.object({
  id: z.string(),
  service: z.string(),
  type: z.enum(['api_key', 'oauth_token', 'password', 'certificate']),
  encryptedValue: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Credential = z.infer<typeof CredentialSchema>;

export function generateCredentialId(service: string, type: string): string {
  const random = randomBytes(8).toString('hex');
  const hash = createHash('sha256')
    .update(`${service}:${type}:${Date.now()}:${random}`)
    .digest('hex')
    .slice(0, 8);
  return `cred_${service}_${type}_${hash}`;
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export async function secureWipe(filePath: string): Promise<void> {
  const { writeFile, unlink, stat } = await import('node:fs/promises');
  const fileStats = await stat(filePath);
  const randomData = randomBytes(fileStats.size);
  await writeFile(filePath, randomData);
  await unlink(filePath);
}
