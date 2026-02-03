import { describe, it, expect } from 'vitest';
import { DiscordAdapter } from './index.js';
import type { Message } from 'discord.js';

describe('DiscordAdapter', () => {
  describe('parseIncoming', () => {
    it('parses Discord message with full metadata', () => {
      const adapter = new DiscordAdapter('fake-bot-token');

      const discordMessage = {
        id: '1234567890123456789',
        content: 'Hello from Discord!',
        author: {
          id: '9876543210987654321',
          username: 'alice_discord',
          discriminator: '1234',
          bot: false,
        },
        channel: {
          id: '1111222233334444555',
        },
        guild: {
          id: '6666777788889999000',
          name: 'Test Server',
        },
        createdAt: new Date('2024-01-01T00:00:00Z'),
      } as unknown as Message;

      const parsed = adapter.parseIncoming(discordMessage);

      expect(parsed.id).toBe('1234567890123456789');
      expect(parsed.channel).toBe('discord');
      expect(parsed.from).toBe('9876543210987654321');
      expect(parsed.to).toBe('1111222233334444555');
      expect(parsed.text).toBe('Hello from Discord!');
      expect(parsed.timestamp).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(parsed.metadata?.username).toBe('alice_discord');
      expect(parsed.metadata?.discriminator).toBe('1234');
      expect(parsed.metadata?.guildId).toBe('6666777788889999000');
      expect(parsed.metadata?.guildName).toBe('Test Server');
    });

    it('parses Discord DM message without guild', () => {
      const adapter = new DiscordAdapter('fake-bot-token');

      const discordMessage = {
        id: '5555666677778888999',
        content: 'Direct message here',
        author: {
          id: '2222333344445555666',
          username: 'bob_dm',
          discriminator: '0',
          bot: false,
        },
        channel: {
          id: '7777888899990000111',
        },
        guild: null,
        createdAt: new Date('2024-01-02T12:00:00Z'),
      } as unknown as Message;

      const parsed = adapter.parseIncoming(discordMessage);

      expect(parsed.id).toBe('5555666677778888999');
      expect(parsed.channel).toBe('discord');
      expect(parsed.from).toBe('2222333344445555666');
      expect(parsed.to).toBe('7777888899990000111');
      expect(parsed.text).toBe('Direct message here');
      expect(parsed.timestamp).toEqual(new Date('2024-01-02T12:00:00Z'));
      expect(parsed.metadata?.username).toBe('bob_dm');
      expect(parsed.metadata?.discriminator).toBe('0');
      expect(parsed.metadata?.guildId).toBeUndefined();
      expect(parsed.metadata?.guildName).toBeUndefined();
    });

    it('handles message with minimal data', () => {
      const adapter = new DiscordAdapter('fake-bot-token');

      const discordMessage = {
        id: '1010101010101010101',
        content: 'Minimal message',
        author: {
          id: '2020202020202020202',
          username: 'charlie',
          discriminator: '0',
          bot: false,
        },
        channel: {
          id: '3030303030303030303',
        },
        guild: null,
        createdAt: new Date('2024-01-03T08:30:00Z'),
      } as unknown as Message;

      const parsed = adapter.parseIncoming(discordMessage);

      expect(parsed.id).toBe('1010101010101010101');
      expect(parsed.text).toBe('Minimal message');
      expect(parsed.from).toBe('2020202020202020202');
      expect(parsed.to).toBe('3030303030303030303');
    });
  });

  describe('formatOutgoing', () => {
    it('formats outgoing message to Discord message options', () => {
      const adapter = new DiscordAdapter('fake-bot-token');

      const message = {
        text: 'Hello back from OpenPaw!',
        metadata: { custom: 'data' },
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        content: 'Hello back from OpenPaw!',
      });
    });

    it('formats simple text message', () => {
      const adapter = new DiscordAdapter('fake-bot-token');

      const message = {
        text: 'Simple Discord reply',
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        content: 'Simple Discord reply',
      });
    });
  });
});
