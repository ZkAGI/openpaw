import { z } from 'zod';
import { Bot, type Context } from 'grammy';
import type { Message, Update } from 'grammy/types';

export const IncomingMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('telegram'),
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

export class TelegramAdapter implements ChannelAdapter {
  name = 'telegram';
  private messageHandler?: (msg: IncomingMessage) => void;
  private bot?: Bot;

  constructor(private botToken: string) {}

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    this.bot.on('message:text', (ctx) => {
      if (this.messageHandler && ctx.message) {
        const parsed = this.parseIncoming(ctx.update);
        this.messageHandler(parsed);
      }
    });

    await this.bot.start();
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  async send(to: string, message: ChannelMessage): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot not connected');
    }
    const formatted = this.formatOutgoing(message);
    await this.bot.api.sendMessage(to, (formatted as { text: string }).text);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  parseIncoming(raw: unknown): IncomingMessage {
    const update = raw as Update;

    if (!update.message || !('text' in update.message)) {
      throw new Error('Invalid Telegram message: missing text');
    }

    const msg = update.message as Message.TextMessage;

    if (!msg.from) {
      throw new Error('Invalid Telegram message: missing from field');
    }

    const messageId = String(msg.message_id);
    const text = msg.text;
    const fromId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const timestamp = new Date(msg.date * 1000);

    return {
      id: messageId,
      channel: 'telegram',
      from: fromId,
      to: chatId,
      text,
      timestamp,
      metadata: {
        username: msg.from.username,
        firstName: msg.from.first_name,
        lastName: msg.from.last_name,
        chatType: msg.chat.type,
      },
    };
  }

  formatOutgoing(msg: ChannelMessage): { text: string } {
    return {
      text: msg.text,
    };
  }
}
