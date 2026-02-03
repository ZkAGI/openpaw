import { describe, it, expect } from 'vitest';
import { SlackAdapter } from './index.js';
import type { MessageEvent } from '@slack/bolt';

describe('SlackAdapter', () => {
  describe('parseIncoming', () => {
    it('parses Slack message event with full metadata', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const slackEvent: MessageEvent = {
        type: 'message',
        subtype: undefined,
        channel: 'C1234567890',
        user: 'U9876543210',
        text: 'Hello from Slack!',
        ts: '1704067200.123456',
        team: 'T0000000000',
        channel_type: 'channel',
      };

      const parsed = adapter.parseIncoming(slackEvent);

      expect(parsed.id).toBe('1704067200.123456');
      expect(parsed.channel).toBe('slack');
      expect(parsed.from).toBe('U9876543210');
      expect(parsed.to).toBe('C1234567890');
      expect(parsed.text).toBe('Hello from Slack!');
      expect(parsed.timestamp).toEqual(new Date(1704067200123));
      expect(parsed.metadata?.team).toBe('T0000000000');
      expect(parsed.metadata?.channelType).toBe('channel');
    });

    it('parses Slack thread message', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const slackEvent: MessageEvent = {
        type: 'message',
        subtype: undefined,
        channel: 'C9999999999',
        user: 'U1111111111',
        text: 'Thread reply here',
        ts: '1704153600.789012',
        thread_ts: '1704153500.111111',
        team: 'T1111111111',
        channel_type: 'channel',
      };

      const parsed = adapter.parseIncoming(slackEvent);

      expect(parsed.id).toBe('1704153600.789012');
      expect(parsed.channel).toBe('slack');
      expect(parsed.from).toBe('U1111111111');
      expect(parsed.to).toBe('C9999999999');
      expect(parsed.text).toBe('Thread reply here');
      expect(parsed.timestamp).toEqual(new Date(1704153600789));
      expect(parsed.metadata?.team).toBe('T1111111111');
      expect(parsed.metadata?.threadTs).toBe('1704153500.111111');
      expect(parsed.metadata?.channelType).toBe('channel');
    });

    it('parses Slack DM message', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const slackEvent: MessageEvent = {
        type: 'message',
        subtype: undefined,
        channel: 'D5555555555',
        user: 'U2222222222',
        text: 'Direct message',
        ts: '1704240000.456789',
        team: 'T2222222222',
        channel_type: 'im',
      };

      const parsed = adapter.parseIncoming(slackEvent);

      expect(parsed.id).toBe('1704240000.456789');
      expect(parsed.channel).toBe('slack');
      expect(parsed.from).toBe('U2222222222');
      expect(parsed.to).toBe('D5555555555');
      expect(parsed.text).toBe('Direct message');
      expect(parsed.metadata?.channelType).toBe('im');
    });

    it('handles message without user (e.g., bot message)', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const slackEvent = {
        type: 'message',
        channel: 'C7777777777',
        text: 'Bot message',
        ts: '1704300000.999999',
        team: 'T3333333333',
        channel_type: 'channel',
      } as MessageEvent;

      const parsed = adapter.parseIncoming(slackEvent);

      expect(parsed.id).toBe('1704300000.999999');
      expect(parsed.from).toBe('');
      expect(parsed.text).toBe('Bot message');
    });
  });

  describe('formatOutgoing', () => {
    it('formats outgoing message to Slack blocks format', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const message = {
        text: 'Hello back from OpenPaw!',
        metadata: { custom: 'data' },
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        text: 'Hello back from OpenPaw!',
      });
    });

    it('formats simple text message', () => {
      const adapter = new SlackAdapter('fake-bot-token', 'fake-signing-secret');

      const message = {
        text: 'Simple Slack reply',
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        text: 'Simple Slack reply',
      });
    });
  });
});
