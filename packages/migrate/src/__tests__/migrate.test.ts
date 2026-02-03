import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyWorkspaceFiles, encryptSession, translateConfig, migrateCredentials, migrateCredentialsFromFile } from '../index.js';
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { decrypt, createVault, generateMasterKey } from '@openpaw/vault';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

describe('Migrate - Workspace Copy', () => {
  const destDir = join(__dirname, 'temp-workspace');

  afterEach(async () => {
    try {
      await rm(destDir, { recursive: true, force: true });
    } catch { /* Ignore cleanup errors */ }
  });

  it('copies all workspace files from source to destination', async () => {
    const copied = await copyWorkspaceFiles(fixturesDir, destDir);

    expect(copied.length).toBeGreaterThan(0);
    expect(copied).toContain('AGENTS.md');
    expect(copied).toContain('SOUL.md');
    expect(copied).toContain('.cursorrules');

    // Verify files exist and content matches
    for (const file of copied) {
      const sourceContent = await readFile(join(fixturesDir, file), 'utf8');
      const destContent = await readFile(join(destDir, file), 'utf8');
      expect(destContent).toBe(sourceContent);
    }
  });

  it('creates destination directory if it does not exist', async () => {
    const nonExistentDest = join(__dirname, 'temp-workspace-new');
    await copyWorkspaceFiles(fixturesDir, nonExistentDest);

    const files = await readdir(nonExistentDest);
    expect(files.length).toBeGreaterThan(0);

    await rm(nonExistentDest, { recursive: true });
  });

  it('only copies specific workspace files', async () => {
    // Create a temp source with extra files
    const tempSource = join(__dirname, 'temp-source');
    await mkdir(tempSource, { recursive: true });
    await writeFile(join(tempSource, 'AGENTS.md'), '# Agents');
    await writeFile(join(tempSource, 'random.txt'), 'should not be copied');
    await writeFile(join(tempSource, 'package.json'), '{}');

    const copied = await copyWorkspaceFiles(tempSource, destDir);

    expect(copied).toContain('AGENTS.md');
    expect(copied).not.toContain('random.txt');
    expect(copied).not.toContain('package.json');

    await rm(tempSource, { recursive: true });
  });

  it('preserves exact file content including newlines', async () => {
    const testContent = 'Line 1\n\nLine 3\n  Indented\n';
    const tempSource = join(__dirname, 'temp-source-preserve');
    await mkdir(tempSource, { recursive: true });
    await writeFile(join(tempSource, 'AGENTS.md'), testContent);

    await copyWorkspaceFiles(tempSource, destDir);

    const copiedContent = await readFile(join(destDir, 'AGENTS.md'), 'utf8');
    expect(copiedContent).toBe(testContent);

    await rm(tempSource, { recursive: true });
  });
});

describe('Migrate - Session Encryption', () => {
  const sessionPath = join(fixturesDir, 'session.jsonl');
  const tempEncrypted = join(__dirname, 'temp-session.jsonl.enc');

  afterEach(async () => {
    try {
      await rm(tempEncrypted, { force: true });
    } catch { /* Ignore cleanup errors */ }
  });

  it('encrypts session file with AES-256-GCM', async () => {
    const key = randomBytes(32); // 256-bit key
    const encryptedPath = await encryptSession(sessionPath, key);

    expect(encryptedPath).toBe(`${sessionPath}.enc`);

    // Verify encrypted file exists
    const encrypted = await readFile(encryptedPath, 'utf8');
    expect(encrypted.length).toBeGreaterThan(0);

    // Verify it's base64 encoded
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();

    await rm(encryptedPath);
  });

  it('decrypts session back to original content', async () => {
    const key = randomBytes(32);
    const originalContent = await readFile(sessionPath, 'utf8');

    const encryptedPath = await encryptSession(sessionPath, key);
    const encryptedData = await readFile(encryptedPath, 'utf8');

    // Decrypt using vault's decrypt function
    const decrypted = decrypt(encryptedData, key);

    expect(decrypted).toBe(originalContent);

    await rm(encryptedPath);
  });

  it('produces different ciphertext with same content but different keys', async () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);

    const encrypted1Path = await encryptSession(sessionPath, key1);
    const encrypted1 = await readFile(encrypted1Path, 'utf8');

    await rm(encrypted1Path);

    const encrypted2Path = await encryptSession(sessionPath, key2);
    const encrypted2 = await readFile(encrypted2Path, 'utf8');

    expect(encrypted1).not.toBe(encrypted2);

    await rm(encrypted2Path);
  });

  it('handles multi-line JSONL correctly', async () => {
    const key = randomBytes(32);
    const originalContent = await readFile(sessionPath, 'utf8');
    const lines = originalContent.trim().split('\n');

    expect(lines.length).toBeGreaterThan(1); // Verify it's multi-line

    const encryptedPath = await encryptSession(sessionPath, key);
    const encryptedData = await readFile(encryptedPath, 'utf8');
    const decrypted = decrypt(encryptedData, key);

    // Verify all lines are preserved
    const decryptedLines = decrypted.trim().split('\n');
    expect(decryptedLines.length).toBe(lines.length);

    // Verify each line is valid JSON
    for (const line of decryptedLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    await rm(encryptedPath);
  });
});

describe('Migrate - Config Translation', () => {
  const sourceConfig = join(fixturesDir, 'openclaw.json');
  const destConfig = join(__dirname, 'temp-openpaw.json');

  afterEach(async () => {
    try {
      await rm(destConfig, { force: true });
    } catch { /* Ignore cleanup errors */ }
  });

  it('translates openclaw.json to openpaw.json', async () => {
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    const translated = await readFile(destConfig, 'utf8');
    const config = JSON.parse(translated);

    expect(config.version).toBe('1.0.0');
    expect(config.migrated_from).toBe('openclaw');
    expect(config.migrated_at).toBeDefined();
    expect(new Date(config.migrated_at)).toBeInstanceOf(Date);
  });

  it('preserves all original fields', async () => {
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    const original = JSON.parse(await readFile(sourceConfig, 'utf8'));
    const translated = JSON.parse(await readFile(destConfig, 'utf8'));

    // All original fields should be present
    expect(translated.name).toBe(original.name);
    expect(translated.mcp_servers).toEqual(original.mcp_servers);
    expect(translated.security).toEqual(original.security);
    expect(translated.custom_field).toBe(original.custom_field);
  });

  it('adds migration metadata fields', async () => {
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    const translated = JSON.parse(await readFile(destConfig, 'utf8'));

    expect(translated).toHaveProperty('version');
    expect(translated).toHaveProperty('migrated_from');
    expect(translated).toHaveProperty('migrated_at');
    expect(translated.migrated_from).toBe('openclaw');
  });

  it('supports different migration sources', async () => {
    const sources: Array<'openclaw' | 'cline' | 'cursor' | 'windsurf'> = [
      'openclaw',
      'cline',
      'cursor',
      'windsurf',
    ];

    for (const source of sources) {
      const destPath = join(__dirname, `temp-${source}.json`);
      await translateConfig(sourceConfig, destPath, source);

      const translated = JSON.parse(await readFile(destPath, 'utf8'));
      expect(translated.migrated_from).toBe(source);

      await rm(destPath);
    }
  });

  it('creates valid JSON output', async () => {
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    const content = await readFile(destConfig, 'utf8');

    // Should parse without error
    expect(() => JSON.parse(content)).not.toThrow();

    // Should be pretty-printed (with indentation)
    expect(content).toContain('\n');
    expect(content).toContain('  '); // 2-space indent
  });

  it('handles nested objects correctly', async () => {
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    const original = JSON.parse(await readFile(sourceConfig, 'utf8'));
    const translated = JSON.parse(await readFile(destConfig, 'utf8'));

    // Deep equality check for nested structures
    expect(translated.mcp_servers.github).toEqual(original.mcp_servers.github);
    expect(translated.security).toEqual(original.security);
  });
});

describe('Migrate - Integration', () => {
  it('performs full migration workflow', async () => {
    const sourceDir = fixturesDir;
    const destDir = join(__dirname, 'temp-full-migration');
    const key = randomBytes(32);

    await mkdir(destDir, { recursive: true });

    // Step 1: Copy workspace files
    const copiedFiles = await copyWorkspaceFiles(sourceDir, destDir);
    expect(copiedFiles.length).toBeGreaterThan(0);

    // Step 2: Encrypt session
    const sessionPath = join(sourceDir, 'session.jsonl');
    const encryptedPath = await encryptSession(sessionPath, key);
    expect(encryptedPath).toContain('.enc');

    // Step 3: Translate config
    const sourceConfig = join(sourceDir, 'openclaw.json');
    const destConfig = join(destDir, 'openpaw.json');
    await translateConfig(sourceConfig, destConfig, 'openclaw');

    // Verify all artifacts present
    const destFiles = await readdir(destDir);
    expect(destFiles).toContain('AGENTS.md');
    expect(destFiles).toContain('SOUL.md');
    expect(destFiles).toContain('openpaw.json');

    // Verify session is encrypted
    const encryptedSession = await readFile(encryptedPath, 'utf8');
    const decryptedSession = decrypt(encryptedSession, key);
    const originalSession = await readFile(sessionPath, 'utf8');
    expect(decryptedSession).toBe(originalSession);

    // Cleanup
    await rm(destDir, { recursive: true });
    await rm(encryptedPath);
  });
});

describe('Migrate - Credential Migration', () => {
  const tempOpenclawDir = join(__dirname, 'temp-openclaw');
  const tempVaultPath = join(__dirname, 'temp-vault.json');

  afterEach(async () => {
    try {
      await rm(tempOpenclawDir, { recursive: true, force: true });
    } catch { /* Ignore cleanup errors */ }
    try {
      await rm(tempVaultPath, { force: true });
    } catch { /* Ignore cleanup errors */ }
  });

  it('migrates credentials from auth-profiles.json to vault', async () => {
    // Create test directory structure: ~/.openclaw/agents/test-agent/agent/auth-profiles.json
    const agentDir = join(tempOpenclawDir, 'agents', 'test-agent', 'agent');
    await mkdir(agentDir, { recursive: true });

    // Create auth-profiles.json with real key format
    const authProfiles = {
      version: 1,
      profiles: {
        'google:default': {
          type: 'api_key',
          provider: 'google',
          key: 'AIzaSyB-1234567890abcdefghijklmnopqrstuvwx',
        },
        'openrouter:default': {
          type: 'api_key',
          provider: 'openrouter',
          key: 'sk-or-v1-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        },
      },
    };

    const authProfilesPath = join(agentDir, 'auth-profiles.json');
    await writeFile(authProfilesPath, JSON.stringify(authProfiles, null, 2));

    // Create vault
    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    // Migrate credentials
    const result = await migrateCredentials(tempOpenclawDir, vault);

    // Verify results
    expect(result.profilesProcessed).toBe(2);
    expect(result.credentialsImported).toBe(2);
    expect(result.credentialIds.length).toBe(2);
    expect(result.filesBackedUp.length).toBe(1);
    expect(result.errors.length).toBe(0);

    // Verify backup exists
    const backupPath = `${authProfilesPath}.bak`;
    const backupStat = await stat(backupPath);
    expect(backupStat.isFile()).toBe(true);

    // Verify backup contains original data
    const backupContent = JSON.parse(await readFile(backupPath, 'utf8'));
    expect(backupContent.profiles['google:default'].key).toBe('AIzaSyB-1234567890abcdefghijklmnopqrstuvwx');

    // Verify rewritten file has vault references
    const rewritten = JSON.parse(await readFile(authProfilesPath, 'utf8'));
    expect(rewritten.profiles['google:default'].key).toMatch(/^openpaw:vault:cred_/);
    expect(rewritten.profiles['openrouter:default'].key).toMatch(/^openpaw:vault:cred_/);

    // Verify vault contains imported credentials
    const vaultCredentials = vault.list();
    expect(vaultCredentials.length).toBe(2);

    // Verify we can retrieve the original values from vault
    for (const credId of result.credentialIds) {
      const credResult = vault.get(credId);
      expect(credResult).not.toBeNull();
      expect(credResult!.value.length).toBeGreaterThan(0);
    }
  });

  it('migrates credentials from a single file', async () => {
    // Create temp file
    const tempDir = join(__dirname, 'temp-single-file');
    await mkdir(tempDir, { recursive: true });

    const authProfilesPath = join(tempDir, 'auth-profiles.json');
    const authProfiles = {
      version: 1,
      profiles: {
        'openai:default': {
          type: 'api_key',
          provider: 'openai',
          key: 'sk-testkey12345678901234567890abcdefghij',
        },
      },
    };

    await writeFile(authProfilesPath, JSON.stringify(authProfiles, null, 2));

    // Create vault
    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    // Migrate from single file
    const result = await migrateCredentialsFromFile(authProfilesPath, vault);

    expect(result.profilesProcessed).toBe(1);
    expect(result.credentialsImported).toBe(1);
    expect(result.filesBackedUp.length).toBe(1);

    // Verify rewritten
    const rewritten = JSON.parse(await readFile(authProfilesPath, 'utf8'));
    expect(rewritten.profiles['openai:default'].key).toMatch(/^openpaw:vault:cred_openai_api_key_/);

    // Cleanup
    await rm(tempDir, { recursive: true });
  });

  it('skips already-migrated credentials', async () => {
    const tempDir = join(__dirname, 'temp-already-migrated');
    await mkdir(tempDir, { recursive: true });

    const authProfilesPath = join(tempDir, 'auth-profiles.json');
    const authProfiles = {
      version: 1,
      profiles: {
        'openai:default': {
          type: 'api_key',
          provider: 'openai',
          key: 'openpaw:vault:cred_openai_api_key_12345678', // Already migrated
        },
      },
    };

    await writeFile(authProfilesPath, JSON.stringify(authProfiles, null, 2));

    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    const result = await migrateCredentialsFromFile(authProfilesPath, vault);

    expect(result.profilesProcessed).toBe(1);
    expect(result.credentialsImported).toBe(0); // Should not import again

    // Cleanup
    await rm(tempDir, { recursive: true });
  });

  it('handles multiple agents with auth-profiles.json', async () => {
    // Create multiple agent directories
    const agents = ['agent1', 'agent2', 'agent3'];

    for (const agent of agents) {
      const agentDir = join(tempOpenclawDir, 'agents', agent, 'agent');
      await mkdir(agentDir, { recursive: true });

      await writeFile(
        join(agentDir, 'auth-profiles.json'),
        JSON.stringify({
          version: 1,
          profiles: {
            [`${agent}:default`]: {
              type: 'api_key',
              provider: agent,
              key: `sk-${agent}12345678901234567890abcdefghij`,
            },
          },
        })
      );
    }

    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    const result = await migrateCredentials(tempOpenclawDir, vault);

    expect(result.profilesProcessed).toBe(3);
    expect(result.credentialsImported).toBe(3);
    expect(result.filesBackedUp.length).toBe(3);

    // Verify all three credentials are in vault
    const vaultCredentials = vault.list();
    expect(vaultCredentials.length).toBe(3);
  });

  it('handles missing agents directory gracefully', async () => {
    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    // tempOpenclawDir doesn't exist
    const result = await migrateCredentials(tempOpenclawDir, vault);

    expect(result.profilesProcessed).toBe(0);
    expect(result.credentialsImported).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('preserves profile metadata in rewritten file', async () => {
    const tempDir = join(__dirname, 'temp-metadata');
    await mkdir(tempDir, { recursive: true });

    const authProfilesPath = join(tempDir, 'auth-profiles.json');
    const authProfiles = {
      version: 1,
      profiles: {
        'github:default': {
          type: 'oauth_token',
          provider: 'github',
          key: 'ghp_testtoken1234567890abcdefghijklmnop',
        },
      },
    };

    await writeFile(authProfilesPath, JSON.stringify(authProfiles, null, 2));

    const key = generateMasterKey();
    const vault = await createVault(key, tempVaultPath);

    await migrateCredentialsFromFile(authProfilesPath, vault);

    const rewritten = JSON.parse(await readFile(authProfilesPath, 'utf8'));

    // Verify type and provider are preserved
    expect(rewritten.profiles['github:default'].type).toBe('oauth_token');
    expect(rewritten.profiles['github:default'].provider).toBe('github');
    expect(rewritten.version).toBe(1);

    await rm(tempDir, { recursive: true });
  });
});
