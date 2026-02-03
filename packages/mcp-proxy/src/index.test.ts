import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {
  redactTokens,
  RateLimiter,
  injectCredentials,
  createMcpHandler,
  logAudit,
  type CredentialStore,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './index.js';

describe('MCP Proxy', () => {
  describe('redactTokens', () => {
    it('should redact OpenAI API keys', () => {
      const text = 'Here is my key: sk-abc123def456ghi789jkl012mno345pqr678';
      const redacted = redactTokens(text);
      expect(redacted).toBe('Here is my key: [REDACTED]');
    });

    it('should redact GitHub tokens', () => {
      const text = 'Token: ghp_abcdefghijklmnopqrstuvwxyz123456789';
      const redacted = redactTokens(text);
      expect(redacted).toBe('Token: [REDACTED]');
    });

    it('should redact Slack tokens', () => {
      const text = 'Slack: xoxb-1234567890-abcdefghijklmnop';
      const redacted = redactTokens(text);
      expect(redacted).toBe('Slack: [REDACTED]');
    });

    it('should redact api_ tokens', () => {
      const text = 'API key: api_test1234567890abcdef';
      const redacted = redactTokens(text);
      expect(redacted).toBe('API key: [REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer abc123.def456.ghi789';
      const redacted = redactTokens(text);
      expect(redacted).toBe('Authorization: [REDACTED]');
    });

    it('should handle multiple tokens', () => {
      const text = 'Keys: sk-abc123def456ghi789jkl012mno345pqr678 and ghp_abcdefghijklmnopqrstuvwxyz123456789';
      const redacted = redactTokens(text);
      expect(redacted).toBe('Keys: [REDACTED] and [REDACTED]');
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests under limit', () => {
      const limiter = new RateLimiter(3, 1000);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(true);
    });

    it('should block requests over limit', () => {
      const limiter = new RateLimiter(2, 1000);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(false);
    });

    it('should reset after window expires', async () => {
      const limiter = new RateLimiter(2, 100);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(true);
      expect(limiter.check('test')).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(limiter.check('test')).toBe(true);
    });

    it('should track different keys separately', () => {
      const limiter = new RateLimiter(1, 1000);
      expect(limiter.check('key1')).toBe(true);
      expect(limiter.check('key2')).toBe(true);
      expect(limiter.check('key1')).toBe(false);
      expect(limiter.check('key2')).toBe(false);
    });
  });

  describe('injectCredentials', () => {
    const mockStore: CredentialStore = {
      async get(refId: string) {
        if (refId === 'cred_github_api_key_abc123') {
          return 'ghp_real_token_value';
        }
        if (refId === 'cred_openai_api_key_def456') {
          return 'sk-real_openai_key';
        }
        return undefined;
      },
    };

    it('should inject single credential reference', async () => {
      const input = 'Authorization: {ref:cred_github_api_key_abc123}';
      const result = await injectCredentials(input, mockStore);
      expect(result).toBe('Authorization: ghp_real_token_value');
    });

    it('should inject multiple credential references', async () => {
      const input =
        'GitHub: {ref:cred_github_api_key_abc123}, OpenAI: {ref:cred_openai_api_key_def456}';
      const result = await injectCredentials(input, mockStore);
      expect(result).toBe('GitHub: ghp_real_token_value, OpenAI: sk-real_openai_key');
    });

    it('should handle credentials in objects', async () => {
      const input = {
        authorization: '{ref:cred_github_api_key_abc123}',
        nested: {
          key: '{ref:cred_openai_api_key_def456}',
        },
      };
      const result = await injectCredentials(input, mockStore);
      expect(result).toEqual({
        authorization: 'ghp_real_token_value',
        nested: {
          key: 'sk-real_openai_key',
        },
      });
    });

    it('should handle credentials in arrays', async () => {
      const input = ['{ref:cred_github_api_key_abc123}', '{ref:cred_openai_api_key_def456}'];
      const result = await injectCredentials(input, mockStore);
      expect(result).toEqual(['ghp_real_token_value', 'sk-real_openai_key']);
    });

    it('should leave non-reference strings unchanged', async () => {
      const input = 'normal string without references';
      const result = await injectCredentials(input, mockStore);
      expect(result).toBe('normal string without references');
    });

    it('should handle missing credentials gracefully', async () => {
      const input = '{ref:cred_missing_key_xyz}';
      const result = await injectCredentials(input, mockStore);
      expect(result).toBe('{ref:cred_missing_key_xyz}');
    });
  });

  describe('logAudit', () => {
    const testLogDir = join('/tmp', 'openpaw-test-audit-' + randomBytes(8).toString('hex'));
    const testLogPath = join(testLogDir, 'audit.jsonl');

    beforeEach(async () => {
      await mkdir(testLogDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testLogDir, { recursive: true, force: true });
    });

    it('should write audit log entries', async () => {
      await logAudit(testLogPath, { method: 'tools/call', tool: 'test', status: 'success' });
      await logAudit(testLogPath, { method: 'tools/call', tool: 'test2', status: 'blocked' });

      const content = await readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]);
      expect(entry1.method).toBe('tools/call');
      expect(entry1.tool).toBe('test');
      expect(entry1.status).toBe('success');
      expect(entry1.timestamp).toBeDefined();

      const entry2 = JSON.parse(lines[1]);
      expect(entry2.tool).toBe('test2');
      expect(entry2.status).toBe('blocked');
    });
  });

  describe('createMcpHandler', () => {
    const testLogDir = join('/tmp', 'openpaw-test-mcp-' + randomBytes(8).toString('hex'));
    const testLogPath = join(testLogDir, 'audit.jsonl');

    const mockStore: CredentialStore = {
      async get(refId: string) {
        if (refId === 'cred_test_api_key_123') {
          return 'secret-api-key-value';
        }
        return undefined;
      },
    };

    beforeEach(async () => {
      await mkdir(testLogDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testLogDir, { recursive: true, force: true });
    });

    it('should handle tools/list request', async () => {
      const handler = createMcpHandler({
        tools: [{ name: 'test-tool', description: 'Test tool', inputSchema: {} }],
        resources: [],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      };

      const response = await handler(request);
      expect(response.id).toBe(1);
      expect(response.result).toEqual({
        tools: [{ name: 'test-tool', description: 'Test tool', inputSchema: {} }],
      });
    });

    it('should handle resources/list request', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [{ uri: 'file://test', name: 'Test Resource' }],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/list',
      };

      const response = await handler(request);
      expect(response.id).toBe(2);
      expect(response.result).toEqual({
        resources: [{ uri: 'file://test', name: 'Test Resource' }],
      });
    });

    it('should inject credentials in tools/call', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'api-call',
          arguments: {
            apiKey: '{ref:cred_test_api_key_123}',
          },
        },
      };

      const response = await handler(request);
      expect(response.id).toBe(3);
      expect(response.result).toBeDefined();
      const result = response.result as { params: { arguments: { apiKey: string } } };
      expect(result.params.arguments.apiKey).toBe('secret-api-key-value');
    });

    it('should redact tokens in response', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [],
        credentialStore: {
          async get() {
            return 'sk-abc123def456ghi789jkl012mno345pqr678';
          },
        },
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get-key',
          arguments: {
            key: '{ref:cred_test_api_key_123}',
          },
        },
      };

      const response = await handler(request);
      const responseStr = JSON.stringify(response);
      expect(responseStr).toContain('[REDACTED]');
      expect(responseStr).not.toContain('sk-abc123def456ghi789jkl012mno345pqr678');
    });

    it('should block tools in blockedTools list', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: ['dangerous-tool'] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'dangerous-tool',
        },
      };

      const response = await handler(request);
      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('blocked by policy');

      const auditLog = await readFile(testLogPath, 'utf8');
      expect(auditLog).toContain('blocked');
    });

    it('should enforce rate limits', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 2, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'limited-tool' },
      };

      const res1 = await handler(request);
      expect(res1.error).toBeUndefined();

      const res2 = await handler({ ...request, id: 7 });
      expect(res2.error).toBeUndefined();

      const res3 = await handler({ ...request, id: 8 });
      expect(res3.error).toBeDefined();
      expect(res3.error?.code).toBe(429);
    });

    it('should write audit log for all calls', async () => {
      const handler = createMcpHandler({
        tools: [],
        resources: [],
        credentialStore: mockStore,
        policyConfig: { rateLimit: 10, rateLimitWindow: 60000, blockedTools: [] },
        auditLogPath: testLogPath,
      });

      await handler({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'tool1' },
      });

      await handler({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'tool2' },
      });

      const content = await readFile(testLogPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);

      const entries = lines.map((l) => JSON.parse(l));
      expect(entries.some((e) => e.tool === 'tool1')).toBe(true);
      expect(entries.some((e) => e.tool === 'tool2')).toBe(true);
    });
  });

  describe('stdio server integration', () => {
    let serverProcess: ChildProcess;
    const testServerPath = join('/tmp', 'test-mcp-server-' + randomBytes(8).toString('hex') + '.js');

    beforeEach(async () => {
      const serverCode = `
import { createStdioServer, createMcpHandler } from './index.js';

const handler = createMcpHandler({
  tools: [{ name: 'test-tool', description: 'Test', inputSchema: {} }],
  resources: [],
  credentialStore: {
    async get(refId) {
      if (refId === 'cred_test_key_abc') return 'injected-secret-value';
      return undefined;
    }
  },
  policyConfig: {
    rateLimit: 5,
    rateLimitWindow: 60000,
    blockedTools: ['blocked-tool']
  },
  auditLogPath: '/tmp/audit-test.jsonl'
});

createStdioServer(handler);
`;
      await writeFile(testServerPath, serverCode);
    });

    afterEach(async () => {
      if (serverProcess) {
        serverProcess.kill();
      }
      await rm(testServerPath, { force: true });
    });

    it('should communicate via real stdio', async () => {
      serverProcess = spawn('node', ['--loader', 'tsx', testServerPath], {
        cwd: join(process.cwd(), 'packages', 'mcp-proxy'),
      });

      const responses: string[] = [];
      serverProcess.stdout?.on('data', (data) => {
        responses.push(data.toString().trim());
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      serverProcess.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }) + '\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(responses.length).toBeGreaterThan(0);
      const response = JSON.parse(responses[0]) as JsonRpcResponse;
      expect(response.id).toBe(1);
      expect(response.result).toBeDefined();
    });

    it('should inject credentials via stdio', async () => {
      serverProcess = spawn('node', ['--loader', 'tsx', testServerPath], {
        cwd: join(process.cwd(), 'packages', 'mcp-proxy'),
      });

      const responses: string[] = [];
      serverProcess.stdout?.on('data', (data) => {
        responses.push(data.toString().trim());
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      serverProcess.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'auth-tool',
            arguments: {
              token: '{ref:cred_test_key_abc}',
            },
          },
        }) + '\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(responses.length).toBeGreaterThan(0);
      const response = JSON.parse(responses[0]) as JsonRpcResponse;
      expect(response.id).toBe(2);
      const result = response.result as { params: { arguments: { token: string } } };
      expect(result.params.arguments.token).toBe('injected-secret-value');
    });
  });
});
