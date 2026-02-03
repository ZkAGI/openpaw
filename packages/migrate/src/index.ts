import { z } from 'zod';

export const MigrationSourceSchema = z.enum(['openclaw', 'cline', 'cursor', 'windsurf']);
export type MigrationSource = z.infer<typeof MigrationSourceSchema>;

export interface MigrationResult {
  source: MigrationSource;
  filesProcessed: number;
  sessionsMigrated: number;
  configsTranslated: number;
  errors: string[];
}

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
  const { encrypt } = await import('@openpaw/vault');
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
