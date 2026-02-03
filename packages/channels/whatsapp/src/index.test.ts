import { describe, it, expect } from 'vitest';
import { WhatsAppAdapter } from './index.js';
import type { WAMessage } from '@whiskeysockets/baileys';

describe('WhatsAppAdapter', () => {
  describe('parseIncoming', () => {
    it('parses Baileys text message with conversation field', () => {
      const adapter = new WhatsAppAdapter();

      const baileysMessage: WAMessage = {
        key: {
          remoteJid: '1234567890@s.whatsapp.net',
          fromMe: false,
          id: '3EB0C7E3F8A5D2F1',
        },
        messageTimestamp: 1704067200,
        pushName: 'John Doe',
        message: {
          conversation: 'Hello from WhatsApp!',
        },
      };

      const parsed = adapter.parseIncoming(baileysMessage);

      expect(parsed.id).toBe('3EB0C7E3F8A5D2F1');
      expect(parsed.channel).toBe('whatsapp');
      expect(parsed.from).toBe('1234567890@s.whatsapp.net');
      expect(parsed.to).toBe('1234567890@s.whatsapp.net');
      expect(parsed.text).toBe('Hello from WhatsApp!');
      expect(parsed.timestamp).toEqual(new Date(1704067200000));
      expect(parsed.metadata?.pushName).toBe('John Doe');
      expect(parsed.metadata?.messageType).toBe('conversation');
    });

    it('parses Baileys extended text message', () => {
      const adapter = new WhatsAppAdapter();

      const baileysMessage: WAMessage = {
        key: {
          remoteJid: '9876543210@s.whatsapp.net',
          fromMe: false,
          id: 'ABC123DEF456',
          participant: '1111111111@s.whatsapp.net',
        },
        messageTimestamp: 1704153600,
        pushName: 'Jane Smith',
        message: {
          extendedTextMessage: {
            text: 'This is an extended text message',
          },
        },
      };

      const parsed = adapter.parseIncoming(baileysMessage);

      expect(parsed.id).toBe('ABC123DEF456');
      expect(parsed.channel).toBe('whatsapp');
      expect(parsed.from).toBe('1111111111@s.whatsapp.net');
      expect(parsed.to).toBe('9876543210@s.whatsapp.net');
      expect(parsed.text).toBe('This is an extended text message');
      expect(parsed.timestamp).toEqual(new Date(1704153600000));
      expect(parsed.metadata?.pushName).toBe('Jane Smith');
      expect(parsed.metadata?.messageType).toBe('extendedTextMessage');
    });

    it('handles message with missing optional fields', () => {
      const adapter = new WhatsAppAdapter();

      const baileysMessage: WAMessage = {
        key: {
          remoteJid: '5555555555@s.whatsapp.net',
          fromMe: false,
          id: 'MSG_NO_TIMESTAMP',
        },
        message: {
          conversation: 'Minimal message',
        },
      };

      const parsed = adapter.parseIncoming(baileysMessage);

      expect(parsed.id).toBe('MSG_NO_TIMESTAMP');
      expect(parsed.text).toBe('Minimal message');
      expect(parsed.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('formatOutgoing', () => {
    it('formats outgoing message to Baileys structure', () => {
      const adapter = new WhatsAppAdapter();

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
      const adapter = new WhatsAppAdapter();

      const message = {
        text: 'Simple message',
      };

      const formatted = adapter.formatOutgoing(message);

      expect(formatted).toEqual({
        text: 'Simple message',
      });
    });
  });
});
