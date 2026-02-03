import { z } from 'zod';

export const ChannelMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('whatsapp'),
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

export class WhatsAppAdapter implements ChannelAdapter {
  name = 'whatsapp';
  private messageHandler?: (msg: ChannelMessage) => Promise<void>;

  async connect(): Promise<void> {
    // TODO: Initialize Baileys connection
  }

  async disconnect(): Promise<void> {
    // TODO: Close Baileys connection
  }

  async send(to: string, message: string): Promise<void> {
    // TODO: Send via Baileys
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  parseMessage(raw: unknown): ChannelMessage {
    // TODO: Parse Baileys message format
    return {
      id: '',
      channel: 'whatsapp',
      from: '',
      to: '',
      text: '',
      timestamp: new Date(),
    };
  }
}
