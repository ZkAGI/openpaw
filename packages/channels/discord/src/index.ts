import { z } from 'zod';

export const ChannelMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('discord'),
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

export class DiscordAdapter implements ChannelAdapter {
  name = 'discord';
  private messageHandler?: (msg: ChannelMessage) => Promise<void>;

  constructor(private botToken: string) {}

  async connect(): Promise<void> {
    // TODO: Initialize discord.js client
  }

  async disconnect(): Promise<void> {
    // TODO: Destroy discord.js client
  }

  async send(to: string, message: string): Promise<void> {
    // TODO: Send via discord.js
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  parseMessage(raw: unknown): ChannelMessage {
    // TODO: Parse Discord message format
    return {
      id: '',
      channel: 'discord',
      from: '',
      to: '',
      text: '',
      timestamp: new Date(),
    };
  }
}
