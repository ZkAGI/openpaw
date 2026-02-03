import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { encrypt, decrypt } from '@zkagi/openpaw-vault';

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
