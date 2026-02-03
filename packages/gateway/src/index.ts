import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { encrypt, decrypt } from '@openpaw/vault';

export const DEFAULT_PORT = 18789;

export const SessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastActivity: z.string(),
  metadata: z.record(z.unknown()),
});

export type Session = z.infer<typeof SessionSchema>;

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
}

export function createGateway(port: number = DEFAULT_PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data: Buffer) => {
      const message = data.toString();
      // Echo for now - will be replaced with proper routing
      ws.send(message);
    });
  });

  return wss;
}
