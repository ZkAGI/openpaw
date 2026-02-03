Read CLAUDE.md for project context.

You are Agent 3. You ONLY work on these packages:
- packages/mcp-proxy
- packages/gateway

IMPORTANT: Do NOT edit any files outside these 2 packages.
Do NOT edit CLAUDE.md, root package.json, pnpm-workspace.yaml, or docs/.

## Tasks

### packages/mcp-proxy
- JSON-RPC 2.0 server over stdio (real stdin/stdout streams)
- Handle methods: tools/list, tools/call, resources/list
- Credential injection: replace {ref:cred_xxx} with real value from vault
- Response redaction: scan output for patterns like sk-, api_, Bearer tokens
  Replace with [REDACTED]
- Policy engine: configurable rate limits per tool, blocked tool list
- Audit log: append to .openpaw/audit.jsonl with timestamp, tool, result
- Test: spawn server as child process, send JSON-RPC via stdin, read stdout
- Test: inject credential reference, verify replaced in tool call
- Test: send response containing "sk-abc123", verify redacted
- Test: exceed rate limit, verify rejection response
- Test: make calls, read audit log file, verify entries exist

### packages/gateway
- WebSocket server on port 18789 using 'ws' package
- Accept connections, route messages through a handler pipeline
- Session manager: create/restore sessions, encrypt to disk with AES-256-GCM
- Channel adapter interface: { connect(), disconnect(), send(), onMessage() }
- Load adapters from config file
- Test: start real WS server, connect real WS client, send message, get response
- Test: create session, kill server, restart, verify session restored from disk
- Test: verify adapter interface contract with a test adapter

## Rules
- ALL tests use real function calls. Real stdio. Real WebSocket.
- No vi.mock, no nock, no simulated streams.
- Use vitest with testTimeout: 30000 (real I/O takes time).
- Commit after each package is complete with passing tests.
