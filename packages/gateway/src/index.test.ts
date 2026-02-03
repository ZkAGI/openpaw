import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { randomBytes } from 'node:crypto';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Gateway,
  SessionManager,
  MessagePipeline,
  createGateway,
  type Message,
  type ChannelAdapter,
} from './index.js';

describe('Gateway', () => {
  describe('SessionManager', () => {
    const testDir = join('/tmp', 'openpaw-test-session-' + randomBytes(8).toString('hex'));
    const encryptionKey = randomBytes(32);

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it('should create a session', () => {
      const manager = new SessionManager(testDir, encryptionKey);
      const session = manager.create({ user: 'test-user' });

      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(session.metadata.user).toBe('test-user');
    });

    it('should retrieve a session by id', () => {
      const manager = new SessionManager(testDir, encryptionKey);
      const session = manager.create({ test: true });

      const retrieved = manager.get(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.metadata.test).toBe(true);
    });

    it('should update session metadata', () => {
      const manager = new SessionManager(testDir, encryptionKey);
      const session = manager.create({ count: 0 });

      manager.update(session.id, { count: 1, newField: 'value' });

      const updated = manager.get(session.id);
      expect(updated?.metadata.count).toBe(1);
      expect(updated?.metadata.newField).toBe('value');
      expect(updated?.lastActivity).not.toBe(session.lastActivity);
    });

    it('should persist sessions to disk', async () => {
      const manager = new SessionManager(testDir, encryptionKey);
      manager.create({ key: 'value1' });
      manager.create({ key: 'value2' });

      await manager.persist();

      const manager2 = new SessionManager(testDir, encryptionKey);
      await manager2.restore();

      const sessions = manager2.list();
      expect(sessions).toHaveLength(2);
      expect(sessions.some((s) => s.metadata.key === 'value1')).toBe(true);
      expect(sessions.some((s) => s.metadata.key === 'value2')).toBe(true);
    });

    it('should restore sessions after restart', async () => {
      const manager1 = new SessionManager(testDir, encryptionKey);
      const session1 = manager1.create({ userId: 'user123' });
      const session2 = manager1.create({ userId: 'user456' });
      await manager1.persist();

      const manager2 = new SessionManager(testDir, encryptionKey);
      await manager2.restore();

      const restored1 = manager2.get(session1.id);
      const restored2 = manager2.get(session2.id);

      expect(restored1).toBeDefined();
      expect(restored1?.metadata.userId).toBe('user123');
      expect(restored2).toBeDefined();
      expect(restored2?.metadata.userId).toBe('user456');
    });

    it('should handle restore with no existing file', async () => {
      const manager = new SessionManager(testDir, encryptionKey);
      await expect(manager.restore()).resolves.not.toThrow();
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('MessagePipeline', () => {
    it('should process message through single handler', async () => {
      const pipeline = new MessagePipeline();
      pipeline.use(async (msg) => ({
        ...msg,
        content: msg.content.toUpperCase(),
      }));

      const result = await pipeline.process({
        content: 'hello',
      });

      expect(result.content).toBe('HELLO');
    });

    it('should process message through multiple handlers', async () => {
      const pipeline = new MessagePipeline();

      pipeline.use(async (msg) => ({
        ...msg,
        content: msg.content.toUpperCase(),
      }));

      pipeline.use(async (msg) => ({
        ...msg,
        content: msg.content + '!',
      }));

      pipeline.use(async (msg) => ({
        ...msg,
        metadata: { processed: true },
      }));

      const result = await pipeline.process({
        content: 'hello',
      });

      expect(result.content).toBe('HELLO!');
      expect(result.metadata?.processed).toBe(true);
    });

    it('should maintain order of handlers', async () => {
      const pipeline = new MessagePipeline();
      const order: number[] = [];

      pipeline.use(async (msg) => {
        order.push(1);
        return msg;
      });

      pipeline.use(async (msg) => {
        order.push(2);
        return msg;
      });

      pipeline.use(async (msg) => {
        order.push(3);
        return msg;
      });

      await pipeline.process({ content: 'test' });
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('WebSocket Gateway', () => {
    let gateway: Gateway;
    const testPort = 18700 + Math.floor(Math.random() * 100);

    afterEach(async () => {
      if (gateway) {
        await gateway.close();
      }
    });

    it('should start WebSocket server on specified port', async () => {
      gateway = new Gateway({ port: testPort });

      const client = new WebSocket(`ws://localhost:${testPort}`);
      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          client.close();
          resolve();
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
    });

    it('should handle WebSocket message and respond', async () => {
      gateway = new Gateway({ port: testPort });

      const client = new WebSocket(`ws://localhost:${testPort}`);

      const response = await new Promise<string>((resolve, reject) => {
        client.on('open', () => {
          client.send(JSON.stringify({ content: 'test message' }));
        });

        client.on('message', (data) => {
          resolve(data.toString());
          client.close();
        });

        client.on('error', reject);
        setTimeout(() => reject(new Error('Message timeout')), 5000);
      });

      const parsed = JSON.parse(response);
      expect(parsed.content).toBeDefined();
    });

    it('should process message through pipeline', async () => {
      const pipeline = new MessagePipeline();
      pipeline.use(async (msg) => ({
        ...msg,
        content: msg.content.toUpperCase(),
      }));

      gateway = new Gateway({ port: testPort, pipeline });

      const client = new WebSocket(`ws://localhost:${testPort}`);

      const response = await new Promise<string>((resolve, reject) => {
        client.on('open', () => {
          client.send(JSON.stringify({ content: 'hello' }));
        });

        client.on('message', (data) => {
          resolve(data.toString());
          client.close();
        });

        client.on('error', reject);
        setTimeout(() => reject(new Error('Message timeout')), 5000);
      });

      const parsed = JSON.parse(response);
      expect(parsed.content).toBe('HELLO');
    });

    it('should create session for each connection', async () => {
      const testDir = join('/tmp', 'openpaw-test-ws-' + randomBytes(8).toString('hex'));
      await mkdir(testDir, { recursive: true });

      const sessionManager = new SessionManager(testDir, randomBytes(32));
      gateway = new Gateway({ port: testPort, sessionManager });

      const client = new WebSocket(`ws://localhost:${testPort}`);

      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          client.send(JSON.stringify({ content: 'hello' }));
        });

        client.on('message', () => {
          client.close();
        });

        client.on('close', () => resolve());
        client.on('error', reject);
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      const sessions = sessionManager.list();
      expect(sessions.length).toBeGreaterThan(0);

      await rm(testDir, { recursive: true, force: true });
    });

    it('should handle multiple concurrent connections', async () => {
      gateway = new Gateway({ port: testPort });

      const clients = Array.from({ length: 3 }, () => new WebSocket(`ws://localhost:${testPort}`));

      const responses = await Promise.all(
        clients.map(
          (client, idx) =>
            new Promise<string>((resolve, reject) => {
              client.on('open', () => {
                client.send(JSON.stringify({ content: `message${idx}` }));
              });

              client.on('message', (data) => {
                resolve(data.toString());
                client.close();
              });

              client.on('error', reject);
              setTimeout(() => reject(new Error('Timeout')), 5000);
            })
        )
      );

      expect(responses).toHaveLength(3);
      responses.forEach((resp) => {
        const parsed = JSON.parse(resp);
        expect(parsed.content).toMatch(/message\d/);
      });
    });
  });

  describe('ChannelAdapter', () => {
    class TestAdapter implements ChannelAdapter {
      name = 'test-adapter';
      private messageHandler?: (message: Message) => Promise<void>;
      private connected = false;
      public sentMessages: Message[] = [];

      async connect(): Promise<void> {
        this.connected = true;
      }

      async disconnect(): Promise<void> {
        this.connected = false;
      }

      async send(message: Message): Promise<void> {
        if (!this.connected) {
          throw new Error('Adapter not connected');
        }
        this.sentMessages.push(message);
      }

      onMessage(handler: (message: Message) => Promise<void>): void {
        this.messageHandler = handler;
      }

      async simulateIncoming(message: Message): Promise<void> {
        if (this.messageHandler) {
          await this.messageHandler(message);
        }
      }

      isConnected(): boolean {
        return this.connected;
      }
    }

    let gateway: Gateway;
    const testPort = 18800 + Math.floor(Math.random() * 100);

    afterEach(async () => {
      if (gateway) {
        await gateway.close();
      }
    });

    it('should register and connect adapter', async () => {
      gateway = new Gateway({ port: testPort });
      const adapter = new TestAdapter();

      await gateway.registerAdapter(adapter);

      expect(adapter.isConnected()).toBe(true);
    });

    it('should process messages from adapter through pipeline', async () => {
      const pipeline = new MessagePipeline();
      pipeline.use(async (msg) => ({
        ...msg,
        content: `Processed: ${msg.content}`,
      }));

      gateway = new Gateway({ port: testPort, pipeline });
      const adapter = new TestAdapter();

      await gateway.registerAdapter(adapter);

      await adapter.simulateIncoming({
        content: 'test message',
        channelId: 'test-channel',
      });

      expect(adapter.sentMessages).toHaveLength(1);
      expect(adapter.sentMessages[0].content).toBe('Processed: test message');
    });

    it('should unregister and disconnect adapter', async () => {
      gateway = new Gateway({ port: testPort });
      const adapter = new TestAdapter();

      await gateway.registerAdapter(adapter);
      expect(adapter.isConnected()).toBe(true);

      await gateway.unregisterAdapter('test-adapter');
      expect(adapter.isConnected()).toBe(false);
    });

    it('should handle multiple adapters', async () => {
      gateway = new Gateway({ port: testPort });
      const adapter1 = new TestAdapter();
      adapter1.name = 'adapter1';
      const adapter2 = new TestAdapter();
      adapter2.name = 'adapter2';

      await gateway.registerAdapter(adapter1);
      await gateway.registerAdapter(adapter2);

      expect(adapter1.isConnected()).toBe(true);
      expect(adapter2.isConnected()).toBe(true);

      await adapter1.simulateIncoming({ content: 'msg1' });
      await adapter2.simulateIncoming({ content: 'msg2' });

      expect(adapter1.sentMessages).toHaveLength(1);
      expect(adapter2.sentMessages).toHaveLength(1);
    });
  });

  describe('legacy createGateway', () => {
    let wss: ReturnType<typeof createGateway>;
    const testPort = 18900 + Math.floor(Math.random() * 100);

    afterEach(() => {
      if (wss) {
        wss.close();
      }
    });

    it('should create basic WebSocket server', async () => {
      wss = createGateway(testPort);

      const client = new WebSocket(`ws://localhost:${testPort}`);

      const echoed = await new Promise<string>((resolve, reject) => {
        client.on('open', () => {
          client.send('test message');
        });

        client.on('message', (data) => {
          resolve(data.toString());
          client.close();
        });

        client.on('error', reject);
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      expect(echoed).toBe('test message');
    });
  });

  describe('Gateway integration', () => {
    let gateway: Gateway;
    const testPort = 19000 + Math.floor(Math.random() * 100);
    const testDir = join('/tmp', 'openpaw-test-integration-' + randomBytes(8).toString('hex'));

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      if (gateway) {
        await gateway.close();
      }
      await rm(testDir, { recursive: true, force: true });
    });

    it('should persist and restore sessions across restart', async () => {
      const encryptionKey = randomBytes(32);
      const sessionManager1 = new SessionManager(testDir, encryptionKey);
      gateway = new Gateway({ port: testPort, sessionManager: sessionManager1 });

      const client = new WebSocket(`ws://localhost:${testPort}`);

      await new Promise<void>((resolve, reject) => {
        client.on('open', () => {
          client.send(JSON.stringify({ content: 'test' }));
        });

        client.on('message', () => {
          client.close();
        });

        client.on('close', () => resolve());
        client.on('error', reject);
        setTimeout(() => reject(new Error('Timeout')), 5000);
      });

      await sessionManager1.persist();
      await gateway.close();

      const sessionManager2 = new SessionManager(testDir, encryptionKey);
      await sessionManager2.restore();
      gateway = new Gateway({ port: testPort, sessionManager: sessionManager2 });

      const sessions = sessionManager2.list();
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0].metadata.transport).toBe('websocket');
    });
  });
});
