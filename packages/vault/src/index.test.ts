import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, generateCredentialId } from './index.js';

describe('vault', () => {
  describe('encrypt/decrypt', () => {
    it('round-trips data correctly with AES-256-GCM', () => {
      const key = randomBytes(32);
      const plaintext = 'test-api-key-12345';

      const ciphertext = encrypt(plaintext, key);
      const decrypted = decrypt(ciphertext, key);

      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const key = randomBytes(32);
      const plaintext = 'test-api-key';

      const ciphertext1 = encrypt(plaintext, key);
      const ciphertext2 = encrypt(plaintext, key);

      expect(ciphertext1).not.toBe(ciphertext2);
    });
  });

  describe('generateCredentialId', () => {
    it('generates ID in correct format', () => {
      const id = generateCredentialId('openai', 'api_key');

      expect(id).toMatch(/^cred_openai_api_key_[a-f0-9]{8}$/);
    });

    it('generates unique IDs', () => {
      const id1 = generateCredentialId('openai', 'api_key');
      const id2 = generateCredentialId('openai', 'api_key');

      expect(id1).not.toBe(id2);
    });
  });
});
