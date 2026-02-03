import { z } from 'zod';
import { App, type MessageEvent, type SayFn } from '@slack/bolt';

export const IncomingMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('slack'),
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

export class SlackAdapter implements ChannelAdapter {
  name = 'slack';
  private messageHandler?: (msg: IncomingMessage) => void;
  private app?: App;

  constructor(
    private botToken: string,
    private signingSecret: string
  ) {}

  async connect(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
    });

    this.app.message(async ({ message, say }) => {
      if ('text' in message && message.text && this.messageHandler) {
        const parsed = this.parseIncoming(message);
        this.messageHandler(parsed);
      }
    });

    await this.app.start(3000);
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }
  }

  async send(to: string, message: ChannelMessage): Promise<void> {
    if (!this.app) {
      throw new Error('App not connected');
    }

    const formatted = this.formatOutgoing(message);
    await this.app.client.chat.postMessage({
      channel: to,
      text: (formatted as { text: string }).text,
    });
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  parseIncoming(raw: unknown): IncomingMessage {
    const event = raw as MessageEvent;

    if (!('text' in event) || !event.text) {
      throw new Error('Invalid Slack message: missing text');
    }

    const messageId = event.ts;
    const text = event.text;
    const fromId = event.user || '';
    const channelId = event.channel;
    const timestamp = new Date(parseFloat(event.ts) * 1000);

    return {
      id: messageId,
      channel: 'slack',
      from: fromId,
      to: channelId,
      text,
      timestamp,
      metadata: {
        team: ('team' in event) ? event.team : undefined,
        threadTs: ('thread_ts' in event) ? event.thread_ts : undefined,
        channelType: event.channel_type,
      },
    };
  }

  formatOutgoing(msg: ChannelMessage): { text: string } {
    return {
      text: msg.text,
    };
  }
}
