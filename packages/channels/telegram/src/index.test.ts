import { describe, it, expect } from 'vitest';
import { TelegramAdapter } from './index.js';
import type { Update } from 'grammy/types';

describe('TelegramAdapter', () => {
  describe('parseIncoming', () => {
    it('parses Telegram text message Update', () => {
      const adapter = new TelegramAdapter('fake-bot-token');

      const telegramUpdate: Update = {
        update_id: 123456789,
        message: {
          message_id: 987654,
          date: 1704067200,
          chat: {
            id: 1234567890,
            type: 'private',
            first_name: 'Alice',
          },
          from: {
            id: 1234567890,
            is_bot: false,
            first_name: 'Alice',
            username: 'alice_user',
          },
          text: 'Hello from Telegram!',
        },
      };

      const parsed = adapter.parseIncoming(telegramUpdate);

      expect(parsed.id).toBe('987654');
      expect(parsed.channel).toBe('telegram');
      expect(parsed.from).toBe('1234567890');
      expect(parsed.to).toBe('1234567890');
      expect(parsed.text).toBe('Hello from Telegram!');
      expect(parsed.timestamp).toEqual(new Date(1704067200000));
      expect(parsed.metadata?.username).toBe('alice_user');
      expect(parsed.metadata?.firstName).toBe('Alice');
      expect(parsed.metadata?.chatType).toBe('private');
    });

    it('parses Telegram message with full user metadata', () => {
      const adapter = new TelegramAdapter('fake-bot-token');

      const telegramUpdate: Update = {
        update_id: 987654321,
        message: {
          message_id: 555555,
          date: 1704153600,
          chat: {
            id: 9876543210,
            type: 'group',
            title: 'Test Group',
          },
          from: {
            id: 9876543210,
            is_bot: false,
            first_name: 'Bob',
            last_name: 'Builder',
            username: 'bob_builder',
          },
          text: 'Group message here',
        },
      };

      const parsed = adapter.parseIncoming(telegramUpdate);

      expect(parsed.id).toBe('555555');
      expect(parsed.channel).toBe('telegram');
      expect(parsed.from).toBe('9876543210');
      expect(parsed.to).toBe('9876543210');
      expect(parsed.text).toBe('Group message here');
      expect(parsed.timestamp).toEqual(new Date(1704153600000));
      expect(parsed.metadata?.username).toBe('bob_builder');
      expect(parsed.metadata?.firstName).toBe('Bob');
      expect(parsed.metadata?.lastName).toBe('Builder');
      expect(parsed.metadata?.chatType).toBe('group');
    });

    it('parses message with minimal user data', () => {
      const adapter = new TelegramAdapter('fake-bot-token');

      const telegramUpdate: Update = {
        update_id: 111222333,
        message: {
          message_id: 777888,
          date: 1704240000,
          chat: {
            id: 5555555555,
            type: 'private',
            first_name: 'Charlie',
          },
          from: {
            id: 5555555555,
            is_bot: false,
            first_name: 'Charlie',
          },
          text: 'Minimal metadata',
        },
      };

      const parsed = adapter.parseIncoming(telegramUpdate);

      expect(parsed.id).toBe('777888');
      expect(parsed.text).toBe('Minimal metadata');
      expect(parsed.metadata?.firstName).toBe('Charlie');
      expect(parsed.metadata?.username).toBeUndefined();
      expect(parsed.metadata?.lastName).toBeUndefined();
    });
  });

  describe('formatOutgoing', () => {
    it('formats outgoing message to Telegram sendMessage params', () => {
      const adapter = new TelegramAdapter('fake-bot-token');

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
      const adapter = new TelegramAdapter('fake-bot-token');

      const message = {
        text: 'Simple reply',
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        text: 'Simple reply',
      });
    });
  });
});
