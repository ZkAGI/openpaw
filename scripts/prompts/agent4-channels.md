Read CLAUDE.md for project context.

You are Agent 4. You ONLY work on these packages:
- packages/channels/whatsapp
- packages/channels/telegram
- packages/channels/discord
- packages/channels/slack

IMPORTANT: Do NOT edit any files outside packages/channels/.
Do NOT edit CLAUDE.md, root package.json, pnpm-workspace.yaml, or docs/.

## Tasks

### Shared ChannelAdapter Interface (define in each package)
```typescript
interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: ChannelMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  parseIncoming(raw: unknown): IncomingMessage;
  formatOutgoing(msg: ChannelMessage): unknown;
}
```

### packages/channels/whatsapp
- Adapter using @whiskeysockets/baileys types
- parseIncoming: convert Baileys message format → IncomingMessage
- formatOutgoing: convert ChannelMessage → Baileys send format
- Test: parse a real Baileys message fixture, verify fields mapped
- Test: format outgoing, verify Baileys structure

### packages/channels/telegram
- Adapter using grammy types
- parseIncoming: convert Telegram Update → IncomingMessage
- formatOutgoing: convert ChannelMessage → Telegram sendMessage params
- Test: parse real Telegram Update fixture, verify fields
- Test: format outgoing, verify Telegram API structure

### packages/channels/discord
- Adapter using discord.js types
- parseIncoming: convert Discord Message → IncomingMessage
- formatOutgoing: convert ChannelMessage → Discord message options
- Test: parse real Discord message fixture, verify fields

### packages/channels/slack
- Adapter using @slack/bolt types
- parseIncoming: convert Slack event → IncomingMessage
- formatOutgoing: convert ChannelMessage → Slack blocks
- Test: parse real Slack event fixture, verify fields

## Rules
- Tests use real message fixture objects (actual API shapes), not mocks.
- Each adapter must implement the full ChannelAdapter interface.
- Commit each adapter separately with passing tests.
