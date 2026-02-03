import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { encrypt, decrypt, createVault, type Vault } from '@zkagi/openpaw-vault';

export const DEFAULT_PORT = 18789;

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastActivity: z.string(),
  metadata: z.record(z.unknown()),
});

export type Session = z.infer<typeof SessionSchema>;

export const MessageSchema = z.object({
  sessionId: z.string().optional(),
  channelId: z.string().optional(),
  userId: z.string().optional(),
  content: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export interface ChannelAdapter {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: Message): Promise<void>;
  onMessage(handler: (message: Message) => Promise<void>): void;
}

export type MessageHandler = (message: Message) => Promise<Message>;

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  constructor(
    private persistDir: string,
    private encryptionKey: Buffer
  ) {}

  create(metadata: Record<string, unknown> = {}): Session {
    const session: Session = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      metadata,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  update(id: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date().toISOString();
      session.metadata = { ...session.metadata, ...metadata };
    }
  }

  async persist(): Promise<void> {
    await mkdir(this.persistDir, { recursive: true });
    const data = JSON.stringify(Array.from(this.sessions.entries()));
    const encrypted = encrypt(data, this.encryptionKey);
    await writeFile(join(this.persistDir, 'sessions.enc'), encrypted);
  }

  async restore(): Promise<void> {
    try {
      const encrypted = await readFile(join(this.persistDir, 'sessions.enc'), 'utf8');
      const data = decrypt(encrypted, this.encryptionKey);
      const entries = JSON.parse(data) as Array<[string, Session]>;
      this.sessions = new Map(entries);
    } catch {
      // No sessions to restore
    }
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }
}

export class MessagePipeline {
  private handlers: MessageHandler[] = [];

  use(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async process(message: Message): Promise<Message> {
    let result = message;
    for (const handler of this.handlers) {
      result = await handler(result);
    }
    return result;
  }
}

export interface GatewayConfig {
  port?: number;
  sessionManager?: SessionManager;
  pipeline?: MessagePipeline;
  adapters?: ChannelAdapter[];
}

export class Gateway {
  private wss: WebSocketServer;
  private sessionManager: SessionManager;
  private pipeline: MessagePipeline;
  private adapters: Map<string, ChannelAdapter> = new Map();
  private clients: Map<string, WebSocket> = new Map();

  constructor(config: GatewayConfig = {}) {
    this.wss = new WebSocketServer({ port: config.port ?? DEFAULT_PORT });
    this.sessionManager =
      config.sessionManager ??
      new SessionManager('/tmp/.openpaw/sessions', Buffer.alloc(32, 'dev-key'));
    this.pipeline = config.pipeline ?? new MessagePipeline();

    if (config.adapters) {
      for (const adapter of config.adapters) {
        this.adapters.set(adapter.name, adapter);
      }
    }

    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const session = this.sessionManager.create({ transport: 'websocket' });
      this.clients.set(session.id, ws);

      ws.on('message', async (data: Buffer) => {
        try {
          const rawMessage = JSON.parse(data.toString());
          const message: Message = {
            sessionId: session.id,
            content: rawMessage.content ?? data.toString(),
            metadata: rawMessage.metadata ?? {},
          };

          const response = await this.pipeline.process(message);
          ws.send(JSON.stringify(response));

          this.sessionManager.update(session.id, {
            lastMessage: message.content,
          });
        } catch (err) {
          ws.send(
            JSON.stringify({
              error: 'Failed to process message',
              details: err instanceof Error ? err.message : String(err),
            })
          );
        }
      });

      ws.on('close', () => {
        this.clients.delete(session.id);
      });
    });
  }

  async registerAdapter(adapter: ChannelAdapter): Promise<void> {
    this.adapters.set(adapter.name, adapter);
    adapter.onMessage(async (message: Message) => {
      const response = await this.pipeline.process(message);
      await adapter.send(response);
    });
    await adapter.connect();
  }

  async unregisterAdapter(name: string): Promise<void> {
    const adapter = this.adapters.get(name);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(name);
    }
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  getPipeline(): MessagePipeline {
    return this.pipeline;
  }

  async close(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.disconnect();
    }

    for (const ws of this.clients.values()) {
      ws.close();
    }

    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getServer(): WebSocketServer {
    return this.wss;
  }
}

export function createGateway(port: number = DEFAULT_PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data: Buffer) => {
      const message = data.toString();
      ws.send(message);
    });
  });

  return wss;
}

// ============================================================================
// OpenPaw Gateway Start Command
// ============================================================================

export interface GatewayStartConfig {
  port?: number;
  openclawDir?: string;
  openpawDir?: string;
}

export interface GatewayStartResult {
  port: number;
  openclawProcess: ChildProcess | null;
  cleanup: () => Promise<void>;
}

interface AuthProfile {
  [key: string]: unknown;
  key?: string;
}

interface AuthProfilesFile {
  profiles?: Record<string, AuthProfile>;
  [key: string]: unknown;
}

/**
 * Find the OpenClaw binary location
 */
async function findOpenClawBinary(openclawDir: string): Promise<string | null> {
  // Check if 'openclaw' is in PATH
  const pathBinary = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const pathDirs = (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':');

  for (const dir of pathDirs) {
    const fullPath = join(dir, pathBinary);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Check in ~/.openclaw/node_modules/.bin/openclaw
  const localBinary = join(openclawDir, 'node_modules', '.bin', 'openclaw');
  if (existsSync(localBinary)) {
    return localBinary;
  }

  // Will use npx as fallback
  return null;
}

/**
 * Find all auth-profiles.json files in OpenClaw agents directory
 */
async function findAuthProfileFiles(openclawDir: string): Promise<string[]> {
  const agentsDir = join(openclawDir, 'agents');
  const profileFiles: string[] = [];

  try {
    const agents = await readdir(agentsDir);
    for (const agent of agents) {
      const agentDir = join(agentsDir, agent, 'agent');
      const profilePath = join(agentDir, 'auth-profiles.json');
      if (existsSync(profilePath)) {
        profileFiles.push(profilePath);
      }
    }
  } catch {
    // No agents directory
  }

  return profileFiles;
}

/**
 * Process auth-profiles.json: replace openpaw:vault: references with real credentials
 */
async function processAuthProfiles(
  profilePath: string,
  vault: Vault,
  backupSuffix: string
): Promise<{ original: string; processed: boolean }> {
  const content = await readFile(profilePath, 'utf8');
  const data = JSON.parse(content) as AuthProfilesFile;
  let modified = false;

  if (data.profiles) {
    for (const profileName of Object.keys(data.profiles)) {
      const profile = data.profiles[profileName];
      if (profile && typeof profile.key === 'string' && profile.key.startsWith('openpaw:vault:')) {
        const credId = profile.key.replace('openpaw:vault:', '');
        const result = vault.get(credId);
        if (result) {
          profile.key = result.value;
          modified = true;
        }
      }
    }
  }

  if (modified) {
    // Backup original
    await copyFile(profilePath, `${profilePath}${backupSuffix}`);
    // Write decrypted version with restricted permissions
    await writeFile(profilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  return { original: content, processed: modified };
}

/**
 * Restore auth-profiles.json from backup
 */
async function restoreAuthProfiles(
  profilePath: string,
  backupSuffix: string
): Promise<void> {
  const backupPath = `${profilePath}${backupSuffix}`;
  if (existsSync(backupPath)) {
    await copyFile(backupPath, profilePath);
    await unlink(backupPath);
  }
}

/**
 * Start the OpenPaw gateway with OpenClaw integration
 *
 * This function:
 * 1. Reads the vault and decrypts credentials into memory
 * 2. Temporarily writes decrypted credentials to auth-profiles.json
 * 3. Spawns OpenClaw as a child process
 * 4. On exit, restores the original auth-profiles.json
 */
export async function startGateway(config: GatewayStartConfig = {}): Promise<GatewayStartResult> {
  const openpawDir = config.openpawDir ?? join(homedir(), '.openpaw');
  const openclawDir = config.openclawDir ?? join(homedir(), '.openclaw');

  const keyFile = join(openpawDir, 'master.key');
  const vaultFile = join(openpawDir, 'vault.json');

  // Read OpenClaw config for port
  let port = config.port ?? DEFAULT_PORT;
  try {
    const openclawConfig = JSON.parse(await readFile(join(openclawDir, 'openclaw.json'), 'utf8'));
    if (openclawConfig.port) {
      port = openclawConfig.port;
    }
  } catch {
    // Use default port
  }

  // Load master key and vault
  let vault: Vault;
  try {
    const keyData = await readFile(keyFile);
    vault = await createVault(keyData, vaultFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Vault not initialized. Run "openpaw vault import" first to set up credentials.');
    }
    throw error;
  }

  // Find and process auth-profiles.json files
  const profileFiles = await findAuthProfileFiles(openclawDir);
  const backupSuffix = '.openpaw-backup';
  const processedFiles: string[] = [];

  for (const profilePath of profileFiles) {
    const result = await processAuthProfiles(profilePath, vault, backupSuffix);
    if (result.processed) {
      processedFiles.push(profilePath);
    }
  }

  // Track cleanup state
  let cleanedUp = false;
  let openclawProcess: ChildProcess | null = null;

  // Cleanup function - restores auth-profiles.json
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;

    console.log('\nRe-encrypting credentials...');

    // Restore all processed auth-profiles.json files
    for (const profilePath of processedFiles) {
      try {
        await restoreAuthProfiles(profilePath, backupSuffix);
        console.log(`  Restored: ${profilePath}`);
      } catch (err) {
        console.error(`  Failed to restore ${profilePath}: ${(err as Error).message}`);
      }
    }

    // Kill OpenClaw process if still running
    if (openclawProcess && !openclawProcess.killed) {
      openclawProcess.kill('SIGTERM');
    }

    console.log('Credentials secured.');
  };

  // Synchronous cleanup for exit handler
  const cleanupSync = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;

    // Synchronous restore using fs module
    const fs = require('node:fs');
    for (const profilePath of processedFiles) {
      try {
        const backupPath = `${profilePath}${backupSuffix}`;
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, profilePath);
          fs.unlinkSync(backupPath);
        }
      } catch {
        // Best effort
      }
    }

    if (openclawProcess && !openclawProcess.killed) {
      openclawProcess.kill('SIGTERM');
    }
  };

  // Register cleanup handlers - bulletproof cleanup
  process.on('exit', cleanupSync);
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });
  process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await cleanup();
    process.exit(1);
  });
  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await cleanup();
    process.exit(1);
  });

  // Find OpenClaw binary
  const openclawBinary = await findOpenClawBinary(openclawDir);

  // Print status
  console.log(`Gateway running on port ${port}. Credentials decrypted in memory. Press Ctrl+C to stop and re-encrypt.`);
  if (processedFiles.length > 0) {
    console.log(`Decrypted ${processedFiles.length} auth-profiles.json file(s)`);
  }

  // Spawn OpenClaw if binary found
  if (openclawBinary) {
    console.log(`Starting OpenClaw: ${openclawBinary}`);
    openclawProcess = spawn(openclawBinary, [], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    openclawProcess.on('exit', async (code) => {
      console.log(`OpenClaw exited with code ${code}`);
      await cleanup();
      process.exit(code ?? 0);
    });

    openclawProcess.on('error', async (err) => {
      console.error(`Failed to start OpenClaw: ${err.message}`);
      await cleanup();
    });
  } else {
    // Try npx openclaw
    console.log('Starting OpenClaw via npx...');
    openclawProcess = spawn('npx', ['openclaw'], {
      stdio: 'inherit',
      env: { ...process.env },
      shell: true,
    });

    openclawProcess.on('exit', async (code) => {
      console.log(`OpenClaw exited with code ${code}`);
      await cleanup();
      process.exit(code ?? 0);
    });

    openclawProcess.on('error', async (err) => {
      console.error(`Failed to start OpenClaw: ${err.message}`);
      // Keep running even without OpenClaw - user may want just the credential management
      console.log('OpenClaw not found. Gateway running in standalone mode.');
    });
  }

  return {
    port,
    openclawProcess,
    cleanup,
  };
}
