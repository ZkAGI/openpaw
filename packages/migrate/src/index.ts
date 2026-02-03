import { z } from 'zod';
import type { Vault } from '@zkagi/openpaw-vault';

export const MigrationSourceSchema = z.enum(['openclaw', 'cline', 'cursor', 'windsurf']);
export type MigrationSource = z.infer<typeof MigrationSourceSchema>;

export interface MigrationResult {
  source: MigrationSource;
  filesProcessed: number;
  sessionsMigrated: number;
  configsTranslated: number;
  errors: string[];
}

export interface CredentialMigrationResult {
  profilesProcessed: number;
  credentialsImported: number;
  filesBackedUp: string[];
  credentialIds: string[];
  errors: string[];
}

// OpenClaw auth-profiles.json schema
export const OpenClawProfileSchema = z.object({
  type: z.string(),
  provider: z.string(),
  key: z.string(),
});

export const OpenClawAuthProfilesSchema = z.object({
  version: z.number(),
  profiles: z.record(z.string(), OpenClawProfileSchema),
});

export type OpenClawAuthProfiles = z.infer<typeof OpenClawAuthProfilesSchema>;

const WORKSPACE_FILES = ['AGENTS.md', 'SOUL.md', '.cursorrules', 'CLAUDE.md'];

export async function copyWorkspaceFiles(sourceDir: string, destDir: string): Promise<string[]> {
  const { readdir, copyFile, mkdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(destDir, { recursive: true });
  const files = await readdir(sourceDir);
  const copied: string[] = [];
  for (const file of files) {
    if (WORKSPACE_FILES.includes(file)) {
      await copyFile(join(sourceDir, file), join(destDir, file));
      copied.push(file);
    }
  }
  return copied;
}

export async function encryptSession(
  sessionPath: string,
  key: Buffer
): Promise<string> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const { encrypt } = await import('@zkagi/openpaw-vault');
  const content = await readFile(sessionPath, 'utf8');
  const encrypted = encrypt(content, key);
  const encryptedPath = `${sessionPath}.enc`;
  await writeFile(encryptedPath, encrypted);
  return encryptedPath;
}

export async function translateConfig(
  sourcePath: string,
  destPath: string,
  source: MigrationSource
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const content = await readFile(sourcePath, 'utf8');
  const sourceConfig = JSON.parse(content) as Record<string, unknown>;
  const openpawConfig = {
    version: '1.0.0',
    migrated_from: source,
    migrated_at: new Date().toISOString(),
    ...sourceConfig,
  };
  await writeFile(destPath, JSON.stringify(openpawConfig, null, 2));
}

/**
 * Maps OpenClaw provider names to credential types
 */
function mapProviderToCredentialType(type: string): 'api_key' | 'oauth_token' | 'password' | 'certificate' {
  if (type === 'oauth' || type === 'oauth_token') return 'oauth_token';
  if (type === 'password') return 'password';
  if (type === 'certificate' || type === 'cert') return 'certificate';
  return 'api_key';
}

/**
 * Migrate credentials from OpenClaw auth-profiles.json files
 *
 * Scans ~/.openclaw/agents/<star>/agent/auth-profiles.json
 * Imports keys to vault, rewrites with "openpaw:vault:<id>" references, backs up to .bak
 */
export async function migrateCredentials(
  openclawDir: string,
  vault: Vault
): Promise<CredentialMigrationResult> {
  const { readFile, writeFile, copyFile, readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const result: CredentialMigrationResult = {
    profilesProcessed: 0,
    credentialsImported: 0,
    filesBackedUp: [],
    credentialIds: [],
    errors: [],
  };

  // Scan ~/.openclaw/agents/*/agent/ for auth-profiles.json
  const agentsDir = join(openclawDir, 'agents');

  let agentDirs: string[];
  try {
    agentDirs = await readdir(agentsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return result; // No agents directory, nothing to migrate
    }
    throw error;
  }

  for (const agentDir of agentDirs) {
    const authProfilesPath = join(agentsDir, agentDir, 'agent', 'auth-profiles.json');

    // Check if auth-profiles.json exists
    try {
      await stat(authProfilesPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue; // No auth-profiles.json in this agent
      }
      throw error;
    }

    try {
      // Read the auth-profiles.json
      const content = await readFile(authProfilesPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate schema
      const authProfiles = OpenClawAuthProfilesSchema.parse(parsed);

      // Create backup
      const backupPath = `${authProfilesPath}.bak`;
      await copyFile(authProfilesPath, backupPath);
      result.filesBackedUp.push(backupPath);

      // Process each profile
      const updatedProfiles: Record<string, { type: string; provider: string; key: string }> = {};

      for (const [profileName, profile] of Object.entries(authProfiles.profiles)) {
        result.profilesProcessed++;

        // Skip if already migrated (key starts with openpaw:vault:)
        if (profile.key.startsWith('openpaw:vault:')) {
          updatedProfiles[profileName] = profile;
          continue;
        }

        // Import to vault
        const credentialType = mapProviderToCredentialType(profile.type);
        const credential = await vault.import(profile.provider, credentialType, profile.key);

        result.credentialsImported++;
        result.credentialIds.push(credential.id);

        // Update profile with vault reference
        updatedProfiles[profileName] = {
          type: profile.type,
          provider: profile.provider,
          key: `openpaw:vault:${credential.id}`,
        };
      }

      // Write updated auth-profiles.json
      const updatedAuthProfiles: OpenClawAuthProfiles = {
        version: authProfiles.version,
        profiles: updatedProfiles,
      };

      await writeFile(authProfilesPath, JSON.stringify(updatedAuthProfiles, null, 2));

    } catch (error) {
      result.errors.push(`Error processing ${authProfilesPath}: ${(error as Error).message}`);
    }
  }

  return result;
}

/**
 * Migrate credentials from a specific auth-profiles.json file
 * Useful for testing or migrating a single file
 */
export async function migrateCredentialsFromFile(
  authProfilesPath: string,
  vault: Vault
): Promise<CredentialMigrationResult> {
  const { readFile, writeFile, copyFile } = await import('node:fs/promises');

  const result: CredentialMigrationResult = {
    profilesProcessed: 0,
    credentialsImported: 0,
    filesBackedUp: [],
    credentialIds: [],
    errors: [],
  };

  try {
    // Read the auth-profiles.json
    const content = await readFile(authProfilesPath, 'utf8');
    const parsed = JSON.parse(content);

    // Validate schema
    const authProfiles = OpenClawAuthProfilesSchema.parse(parsed);

    // Create backup
    const backupPath = `${authProfilesPath}.bak`;
    await copyFile(authProfilesPath, backupPath);
    result.filesBackedUp.push(backupPath);

    // Process each profile
    const updatedProfiles: Record<string, { type: string; provider: string; key: string }> = {};

    for (const [profileName, profile] of Object.entries(authProfiles.profiles)) {
      result.profilesProcessed++;

      // Skip if already migrated (key starts with openpaw:vault:)
      if (profile.key.startsWith('openpaw:vault:')) {
        updatedProfiles[profileName] = profile;
        continue;
      }

      // Import to vault
      const credentialType = mapProviderToCredentialType(profile.type);
      const credential = await vault.import(profile.provider, credentialType, profile.key);

      result.credentialsImported++;
      result.credentialIds.push(credential.id);

      // Update profile with vault reference
      updatedProfiles[profileName] = {
        type: profile.type,
        provider: profile.provider,
        key: `openpaw:vault:${credential.id}`,
      };
    }

    // Write updated auth-profiles.json
    const updatedAuthProfiles: OpenClawAuthProfiles = {
      version: authProfiles.version,
      profiles: updatedProfiles,
    };

    await writeFile(authProfilesPath, JSON.stringify(updatedAuthProfiles, null, 2));

  } catch (error) {
    result.errors.push(`Error processing ${authProfilesPath}: ${(error as Error).message}`);
  }

  return result;
}
