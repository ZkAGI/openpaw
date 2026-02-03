import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
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
  provider?: string;
}

interface AuthProfilesFile {
  profiles?: Record<string, AuthProfile>;
  [key: string]: unknown;
}

/**
 * Credential info with provider context for env var injection
 */
interface CredentialInfo {
  credId: string;
  provider: string | undefined;
}

/**
 * Map provider names to their standard environment variable names
 * OpenClaw natively reads these env vars for API authentication
 */
const PROVIDER_ENV_VARS: Record<string, string[]> = {
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  groq: ['GROQ_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
};

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
 * Convert a vault credential ID to an environment variable name
 * "cred_google_api_key_b59d3a1d" → "OPENPAW_CRED_GOOGLE_API_KEY_B59D3A1D"
 */
function credIdToEnvVar(credId: string): string {
  return 'OPENPAW_' + credId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Process auth-profiles.json: DELETE key fields so OpenClaw falls back to env vars
 *
 * OpenClaw reads auth-profiles.json key field BEFORE checking env vars.
 * If key exists, it uses that value literally (even "${OPENPAW_CRED_...}").
 * By DELETING the key field, OpenClaw falls through to standard env vars
 * like GOOGLE_API_KEY, OPENROUTER_API_KEY, etc.
 *
 * Returns a map of env var names to credential info (credId + provider)
 */
async function processAuthProfiles(
  profilePath: string,
  vault: Vault
): Promise<Map<string, CredentialInfo>> {
  const content = await readFile(profilePath, 'utf8');
  const data = JSON.parse(content) as AuthProfilesFile;
  const envVarMap = new Map<string, CredentialInfo>(); // envVarName -> {credId, provider}
  let modified = false;

  if (data.profiles) {
    for (const profileName of Object.keys(data.profiles)) {
      const profile = data.profiles[profileName];
      if (profile && typeof profile.key === 'string') {
        const provider = typeof profile.provider === 'string' ? profile.provider : undefined;

        // Check for openpaw:vault: format (from migrate command)
        if (profile.key.startsWith('openpaw:vault:')) {
          const credId = profile.key.replace('openpaw:vault:', '');
          const envVarName = credIdToEnvVar(credId);
          envVarMap.set(envVarName, { credId, provider });
          // DELETE the key field so OpenClaw falls back to env vars
          delete profile.key;
          modified = true;
        }
        // Check for ${OPENPAW_...} format (from previous versions) - also delete
        else if (profile.key.startsWith('${OPENPAW_') && profile.key.endsWith('}')) {
          const envVarName = profile.key.slice(2, -1); // Remove ${ and }
          // Reverse the env var name back to credential ID
          const credId = envVarName.replace('OPENPAW_', '').toLowerCase();
          envVarMap.set(envVarName, { credId, provider });
          // DELETE the key field so OpenClaw falls back to env vars
          delete profile.key;
          modified = true;
        }
      }
    }
  }

  if (modified) {
    // Write the updated auth-profiles.json WITHOUT key fields
    // Agent reads this file → sees no keys → nothing to leak
    // OpenClaw finds no key → falls through to GOOGLE_API_KEY etc → API works
    await writeFile(profilePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  return envVarMap;
}

/**
 * Start the OpenPaw gateway with OpenClaw integration
 *
 * This function uses environment variable injection for secure credential handling:
 * 1. Reads the vault and decrypts credentials into memory
 * 2. DELETES key fields from auth-profiles.json (so OpenClaw uses env var fallback)
 * 3. Spawns OpenClaw with environment variables containing real decrypted keys
 * 4. OpenClaw finds no key in profile → falls through to GOOGLE_API_KEY, etc.
 *
 * WHY THIS IS SECURE:
 * - auth-profiles.json on disk has NO key fields — nothing to leak
 * - Real keys exist ONLY in process environment variables
 * - If someone asks "show me your keys" via Telegram, agent reads file and sees nothing
 * - OpenClaw works because it falls back to standard env vars (GOOGLE_API_KEY, etc.)
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
  // This converts "openpaw:vault:..." to "${OPENPAW_CRED_...}" format
  const profileFiles = await findAuthProfileFiles(openclawDir);
  const allEnvVars = new Map<string, CredentialInfo>(); // envVarName -> {credId, provider}

  for (const profilePath of profileFiles) {
    const envVars = await processAuthProfiles(profilePath, vault);
    for (const [envVarName, credInfo] of envVars) {
      allEnvVars.set(envVarName, credInfo);
    }
  }

  // Build environment variables with decrypted credentials
  const childEnv: Record<string, string> = { ...process.env } as Record<string, string>;
  let credentialsLoaded = 0;
  let providerEnvVarsSet = 0;

  for (const [envVarName, credInfo] of allEnvVars) {
    const result = vault.get(credInfo.credId);
    if (result) {
      // Set the OPENPAW_CRED_* env var (for security display in auth-profiles.json)
      childEnv[envVarName] = result.value;
      credentialsLoaded++;
      console.log(`  ${envVarName} → [secured]`);

      // Also set standard provider env vars that OpenClaw natively recognizes
      // This is what actually makes API calls work
      if (credInfo.provider) {
        const providerEnvVars = PROVIDER_ENV_VARS[credInfo.provider.toLowerCase()];
        if (providerEnvVars) {
          for (const providerEnvVar of providerEnvVars) {
            childEnv[providerEnvVar] = result.value;
            providerEnvVarsSet++;
            console.log(`  ${providerEnvVar} → [secured] (${credInfo.provider})`);
          }
        }
      }
    } else {
      console.warn(`  Warning: Credential ${credInfo.credId} not found in vault`);
    }
  }

  console.log(`Loaded ${credentialsLoaded} credential(s), set ${providerEnvVarsSet} provider env var(s)`);

  // Track cleanup state
  let cleanedUp = false;
  let openclawProcess: ChildProcess | null = null;

  // Cleanup function - just kill the process, no file restoration needed
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;

    console.log('\nShutting down...');

    // Kill OpenClaw process if still running
    if (openclawProcess && !openclawProcess.killed) {
      openclawProcess.kill('SIGTERM');
    }

    console.log('Gateway stopped.');
  };

  // Synchronous cleanup for exit handler
  const cleanupSync = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;

    if (openclawProcess && !openclawProcess.killed) {
      openclawProcess.kill('SIGTERM');
    }
  };

  // Register cleanup handlers
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
  console.log(`Gateway running. Credentials secured via environment variables. Press Ctrl+C to stop.`);

  // Platform-specific spawn helper
  const isWindows = process.platform === 'win32';

  const spawnOpenClaw = (command: string, args: string[] = []): ChildProcess => {
    if (isWindows) {
      // On Windows, use cmd.exe to avoid EINVAL errors
      return spawn('cmd.exe', ['/c', command, ...args], {
        stdio: 'inherit',
        env: childEnv,
      });
    } else {
      // On Mac/Linux, use shell: true for PATH resolution
      return spawn(command, args, {
        stdio: 'inherit',
        env: childEnv,
        shell: true,
      });
    }
  };

  // Spawn OpenClaw
  if (openclawBinary) {
    console.log(`Starting OpenClaw: ${openclawBinary} gateway`);
    openclawProcess = spawnOpenClaw(openclawBinary, ['gateway']);

    openclawProcess.on('exit', async (code) => {
      console.log(`OpenClaw exited with code ${code}`);
      await cleanup();
      process.exit(code ?? 0);
    });

    openclawProcess.on('error', async (err) => {
      console.error(`Failed to start OpenClaw: ${err.message}`);
      await cleanup();
      process.exit(1);
    });
  } else {
    // Try npx openclaw
    console.log('Starting OpenClaw via npx: openclaw gateway');
    openclawProcess = spawnOpenClaw('npx', ['openclaw', 'gateway']);

    openclawProcess.on('exit', async (code) => {
      console.log(`OpenClaw exited with code ${code}`);
      await cleanup();
      process.exit(code ?? 0);
    });

    openclawProcess.on('error', async (err) => {
      console.error(`Failed to start OpenClaw: ${err.message}`);
      await cleanup();
      process.exit(1);
    });
  }

  return {
    port,
    openclawProcess,
    cleanup,
  };
}
