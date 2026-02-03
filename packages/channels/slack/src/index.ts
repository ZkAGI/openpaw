import { z } from 'zod';

export const ChannelMessageSchema = z.object({
  id: z.string(),
  channel: z.literal('slack'),
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

export class SlackAdapter implements ChannelAdapter {
  name = 'slack';
  private messageHandler?: (msg: ChannelMessage) => Promise<void>;

  constructor(
    private botToken: string,
    private signingSecret: string
  ) {}

  async connect(): Promise<void> {
    // TODO: Initialize Bolt app
  }

  async disconnect(): Promise<void> {
    // TODO: Stop Bolt app
  }

  async send(to: string, message: string): Promise<void> {
    // TODO: Send via Bolt
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  parseMessage(raw: unknown): ChannelMessage {
    // TODO: Parse Slack message format
    return {
      id: '',
      channel: 'slack',
      from: '',
      to: '',
      text: '',
      timestamp: new Date(),
    };
  }
}
