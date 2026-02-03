---
name: real-testing
description: Testing standards. Activates when writing tests, running tests, or test-related tasks.
---

# Testing Standards — Real Endpoints Only

## Rules
- NO `vi.mock()` for business logic
- NO simulated responses
- NO hardcoded expected outputs that don't come from real execution
- Test isolation via setup/teardown, NOT via mocking

## What "Real" Means Per Package
| Package | "Real" Test Means |
|---------|-------------------|
| vault | Actually encrypt/decrypt with AES-256-GCM, verify round-trip |
| scanner | Parse actual JS/TS AST, scan real fixture files |
| mcp-proxy | Spawn real JSON-RPC server, send real stdio messages |
| gateway | Open real WebSocket, send/receive real frames |
| zk-prover | Compile real circom, generate real proofs, verify them |
| solana | Deploy to devnet, submit real transactions |
| channels | Connect to real API sandbox (Telegram Bot API test mode, etc.) |

## Vitest Config
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // real operations take time
    hookTimeout: 15000,
  }
});
```

## Benchmark Template
Every package MUST include a benchmark:
```typescript
import { bench, describe } from 'vitest';

describe('performance', () => {
  bench('operation under test', async () => {
    // real operation, measured
  });
});
```
