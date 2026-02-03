import { z } from 'zod';
import { createInterface } from 'node:readline';
import { appendFile } from 'node:fs/promises';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

const TOKEN_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
  /Bearer\s+[a-zA-Z0-9._-]+/g,
];

export function redactTokens(text: string): string {
  let redacted = text;
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

export interface PolicyConfig {
  rateLimit: number;
  rateLimitWindow: number;
  blockedTools: string[];
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(
    private limit: number,
    private windowMs: number
  ) {}

  check(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) ?? [];
    const validTimestamps = timestamps.filter((t) => now - t < this.windowMs);
    if (validTimestamps.length >= this.limit) {
      return false;
    }
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    return true;
  }
}

export async function logAudit(logPath: string, entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  await appendFile(logPath, line);
}

export function createStdioServer(handler: (req: JsonRpcRequest) => Promise<JsonRpcResponse>) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    void (async () => {
      try {
        const req = JsonRpcRequestSchema.parse(JSON.parse(line));
        const res = await handler(req);
        process.stdout.write(JSON.stringify(res) + '\n');
      } catch (err) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32600, message: 'Invalid Request' },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    })();
  });
}
