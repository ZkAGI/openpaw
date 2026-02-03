import { z } from 'zod';

export const ChannelMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('telegram'),
  from: z.string(),
  to: z.string(),
  text: z.string(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(),
});

export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

export interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: string): Promise<void>;
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;
}

export class TelegramAdapter implements ChannelAdapter {
  name = 'telegram';
  private messageHandler?: (msg: ChannelMessage) => Promise<void>;

  constructor(private botToken: string) {}

  async connect(): Promise<void> {
    // TODO: Initialize grammY bot
  }

  async disconnect(): Promise<void> {
    // TODO: Stop grammY bot
  }

  async send(to: string, message: string): Promise<void> {
    // TODO: Send via grammY
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  parseMessage(raw: unknown): ChannelMessage {
    // TODO: Parse Telegram message format
    return {
      id: '',
      channel: 'telegram',
      from: '',
      to: '',
      text: '',
      timestamp: new Date(),
    };
  }
}
