import { z } from 'zod';
import type {
  WAMessage,
  proto,
  WASocket,
  AnyMessageContent,
} from '@whiskeysockets/baileys';

export const IncomingMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('whatsapp'),
  from: z.string(),
  to: z.string(),
  text: z.string(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(),
});

export const ChannelMessageSchema = z.object({
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;
export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

export interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: ChannelMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  parseIncoming(raw: unknown): IncomingMessage;
  formatOutgoing(msg: ChannelMessage): unknown;
}

export class WhatsAppAdapter implements ChannelAdapter {
  name = 'whatsapp';
  private messageHandler?: (msg: IncomingMessage) => void;
  private sock: WASocket | null;

  constructor(socket?: WASocket) {
    this.sock = socket || null;
  }

  async connect(): Promise<void> {
    if (!this.sock) {
      throw new Error('WASocket not provided. Initialize with a connected socket.');
    }
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
    }
  }

  async send(to: string, message: ChannelMessage): Promise<void> {
    if (!this.sock) {
      throw new Error('Socket not connected');
    }
    const formatted = this.formatOutgoing(message);
    await this.sock.sendMessage(to, formatted as AnyMessageContent);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
    if (this.sock) {
      this.sock.ev.on('messages.upsert', ({ messages }) => {
        for (const msg of messages) {
          if (msg.message) {
            const parsed = this.parseIncoming(msg);
            handler(parsed);
          }
        }
      });
    }
  }

  parseIncoming(raw: unknown): IncomingMessage {
    const msg = raw as WAMessage;

    const conversation = msg.message?.conversation;
    const extendedText = msg.message?.extendedTextMessage?.text;
    const text = conversation || extendedText || '';

    const fromJid = msg.key.remoteJid || '';
    const participant = msg.key.participant || msg.key.remoteJid || '';
    const messageId = msg.key.id || '';
    const timestamp = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000)
      : new Date();

    return {
      id: messageId,
      channel: 'whatsapp',
      from: participant,
      to: fromJid,
      text,
      timestamp,
      metadata: {
        messageType: Object.keys(msg.message || {})[0],
        pushName: msg.pushName,
      },
    };
  }

  formatOutgoing(msg: ChannelMessage): AnyMessageContent {
    return {
      text: msg.text,
    };
  }
}
