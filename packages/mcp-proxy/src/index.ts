import { z } from 'zod';
import { createInterface } from 'node:readline';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
  /ghp_[a-zA-Z0-9]{35,}/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
  /api_[a-zA-Z0-9_-]{20,}/gi,
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

export interface CredentialStore {
  get(refId: string): Promise<string | undefined>;
}

export async function injectCredentials(
  value: unknown,
  store: CredentialStore
): Promise<unknown> {
  if (typeof value === 'string') {
    const refPattern = /\{ref:(cred_[a-zA-Z0-9_]+)\}/g;
    const matches = Array.from(value.matchAll(refPattern));
    if (matches.length === 0) return value;

    let result = value;
    for (const match of matches) {
      const refId = match[1];
      if (refId) {
        const credential = await store.get(refId);
        if (credential) {
          result = result.replace(match[0], credential);
        }
      }
    }
    return result;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => injectCredentials(item, store)));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = await injectCredentials(val, store);
    }
    return result;
  }

  return value;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Resource {
  uri: string;
  name: string;
  mimeType?: string;
}

export interface McpServerConfig {
  tools: Tool[];
  resources: Resource[];
  credentialStore: CredentialStore;
  policyConfig: PolicyConfig;
  auditLogPath: string;
}

export async function logAudit(logPath: string, entry: Record<string, unknown>): Promise<void> {
  const logDir = join(logPath, '..');
  await mkdir(logDir, { recursive: true });
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  await appendFile(logPath, line);
}

export function createMcpHandler(config: McpServerConfig) {
  const rateLimiter = new RateLimiter(
    config.policyConfig.rateLimit,
    config.policyConfig.rateLimitWindow
  );

  return async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    try {
      if (req.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { tools: config.tools },
        };
      }

      if (req.method === 'resources/list') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { resources: config.resources },
        };
      }

      if (req.method === 'tools/call') {
        const toolName = (req.params?.['name'] as string) ?? '';

        if (config.policyConfig.blockedTools.includes(toolName)) {
          await logAudit(config.auditLogPath, {
            method: req.method,
            tool: toolName,
            status: 'blocked',
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32000, message: `Tool ${toolName} is blocked by policy` },
          };
        }

        if (!rateLimiter.check(toolName)) {
          await logAudit(config.auditLogPath, {
            method: req.method,
            tool: toolName,
            status: 'rate_limited',
          });
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: 429, message: 'Rate limit exceeded' },
          };
        }

        const injectedParams = await injectCredentials(req.params, config.credentialStore);

        const mockResult = {
          success: true,
          tool: toolName,
          params: injectedParams,
        };

        const resultStr = JSON.stringify(mockResult);
        const redactedResult = redactTokens(resultStr);

        await logAudit(config.auditLogPath, {
          method: req.method,
          tool: toolName,
          status: 'success',
        });

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: JSON.parse(redactedResult),
        };
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: 'Method not found' },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };
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
