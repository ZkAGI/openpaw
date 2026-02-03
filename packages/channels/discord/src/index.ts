import { z } from 'zod';
import { Client, Events, GatewayIntentBits, type Message, type MessageCreateOptions } from 'discord.js';

export const IncomingMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('discord'),
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

export class DiscordAdapter implements ChannelAdapter {
  name = 'discord';
  private messageHandler?: (msg: IncomingMessage) => void;
  private client?: Client;

  constructor(private botToken: string) {}

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on(Events.MessageCreate, (message) => {
      if (!message.author.bot && this.messageHandler) {
        const parsed = this.parseIncoming(message);
        this.messageHandler(parsed);
      }
    });

    await this.client.login(this.botToken);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
    }
  }

  async send(to: string, message: ChannelMessage): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const channel = await this.client.channels.fetch(to);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not text-based');
    }

    if (!('send' in channel)) {
      throw new Error('Channel does not support sending messages');
    }

    const formatted = this.formatOutgoing(message);
    await channel.send(formatted as MessageCreateOptions);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  parseIncoming(raw: unknown): IncomingMessage {
    const msg = raw as Message;

    const messageId = msg.id;
    const text = msg.content;
    const fromId = msg.author.id;
    const channelId = msg.channel.id;
    const timestamp = msg.createdAt;

    return {
      id: messageId,
      channel: 'discord',
      from: fromId,
      to: channelId,
      text,
      timestamp,
      metadata: {
        username: msg.author.username,
        discriminator: msg.author.discriminator,
        guildId: msg.guild?.id,
        guildName: msg.guild?.name,
      },
    };
  }

  formatOutgoing(msg: ChannelMessage): MessageCreateOptions {
    return {
      content: msg.text,
    };
  }
}
