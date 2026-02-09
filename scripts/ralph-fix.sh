#!/usr/bin/env bash
set -euo pipefail

cd "/Users/ankitasahu/Developer/ZkAGI/openpaw"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Post-Merge Ralph Fixer (V2 — with WhatsApp + CoVe)"
echo "  Fixes integration issues + failing tests"
echo "═══════════════════════════════════════════════════"
echo ""

PROMPT='Read CLAUDE.md for project context.

All feature branches have been merged. Your job is to make everything build, test, and work together.

## VERIFICATION METHOD (MANDATORY)

Before committing ANY code, you MUST apply Chain-of-Verification (CoVe):

For every function you write or fix:
1. DRAFT: Write the code
2. VERIFY: Ask yourself 3 specific verification questions:
   - "Does this function handle the error case where [X] fails?"
   - "Does this match the actual API shape of [library Y]?"
   - "Can I trace data flow from input to output without any gaps?"
3. CHECK: Answer each independently by re-reading the code
4. REVISE: Fix any inconsistencies found

For every test you write:
1. DRAFT: Write the test
2. VERIFY: Ask yourself:
   - "Does this test use REAL I/O (real files, real crypto, real network)?"
   - "Would this test catch a regression if the implementation was wrong?"
   - "Is the assertion checking the RIGHT thing (not just 'does not throw')?"
3. CHECK: Run the test, verify it fails when the implementation is deliberately broken
4. REVISE: Strengthen any weak assertions

## TASKS (in order)

### 1. Dependencies
- Run: pnpm install
- Fix any workspace reference issues between packages
- Ensure @openpaw/whatsapp can import from @openpaw/vault

### 2. Build
- Run: pnpm build
- Fix ALL TypeScript errors
- Check: no `any` types on public API surfaces (internal is OK)
- KNOWN BUG: packages/channels/whatsapp/src/adapter.ts has a duplicate
  `import * as crypto from "node:crypto"` near line 260. Remove the duplicate.
  The crypto module should only be imported once at the top of the file.

### 3. Tests — ALL REAL, NO MOCKS
- Run: pnpm test
- Fix ALL failing tests
- CRITICAL RULE: Every test must use real function calls:
  - Real AES-256-GCM encryption (node:crypto)
  - Real file system operations (write, read, delete actual files)
  - Real WebSocket connections (start server, connect client)
  - Real JSON-RPC over stdio (spawn child process, pipe stdin/stdout)
  - Real Baileys message fixtures (actual protocol shapes)
- FORBIDDEN: vi.mock(), vi.spyOn() on business logic, nock, sinon stubs
  on core functions, simulated streams, fake crypto
- vi.spyOn() is ONLY allowed for observing calls (e.g., console.log), never
  for replacing implementations

### 4. WhatsApp Integration Wiring
- packages/cli: `openpaw migrate --from openclaw` must call migrateWhatsAppSession()
  after the existing credential migration step
- packages/cli: `openpaw start` must initialize WhatsAppAdapter if whatsapp is
  configured in openpaw.json channels section
- packages/gateway: must load WhatsAppAdapter and route messages through MCP proxy
- The master key for WhatsApp SecureSessionStore is the SAME master key used by
  the credential vault. It is loaded once at startup and passed to both.

### 5. Master Key Flow (verify this is correct)
The master key lifecycle:
  a. Generated on first `openpaw migrate` via crypto.randomBytes(32)
  b. Stored at ~/.openpaw/master.key (or derived via scrypt from machine seed)
  c. Loaded by `openpaw start` at boot
  d. Passed to: credential vault decrypt, session encryption, WhatsApp SecureSessionStore
  e. NEVER written to any log, audit trail, or error message
Verify: grep the entire codebase for any place the master key might be logged or leaked.

### 6. Channel Adapter Integration
- Verify ALL channel adapters implement the same ChannelAdapter interface
- Verify message routing: channel → gateway → MCP proxy → agent → response → channel
- Verify WhatsApp adapter config reads from openpaw.json:
  channels.whatsapp.selfChatMode, channels.whatsapp.dmPolicy, channels.whatsapp.allowFrom

### 7. Benchmarks (add to test suite)
Add benchmark tests that verify performance:
- Vault encrypt+decrypt cycle: < 5ms
- WhatsApp session encrypt (5 files): < 50ms
- WhatsApp session decrypt (5 files): < 50ms
- Skill scanner (10 files): < 500ms
- MCP proxy round-trip (credential injection): < 10ms
Use performance.now() and expect(time).toBeLessThan(threshold).

### 8. CLI Commands
- Verify `openpaw status` works (show running services, vault stats, channel status)
- Verify `openpaw doctor` works (check deps, permissions, configs)
- Add `openpaw channels` command: list configured channels and their status

### 9. README Update
- Update README.md with:
  - Install: npm install -g @zkagi/openpaw (or @sahu-01/openpaw)
  - Migrate: openpaw migrate --from openclaw
  - Start: openpaw start
  - WhatsApp setup: configure channels.whatsapp in openpaw.json
  - Architecture diagram (text-based)

### 10. Final Verification
Run this sequence — ALL must pass:
```
pnpm build
pnpm test
pnpm lint
```

Then apply CoVe one final time:
- Q1: "Are there any tests that would pass even with a broken implementation?"
  → Find and strengthen them
- Q2: "Is the master key ever exposed in logs, errors, or test output?"
  → Grep and verify
- Q3: "Does the WhatsApp adapter properly flush on SIGTERM?"
  → Check signal handler exists in gateway

When ALL of this passes: say DONE.

## CRITICAL RULES
- ALL tests must use real function calls. ZERO mocks on business logic.
- Circom + Groth16 ONLY for ZK references. NEVER SP1. NEVER RISC Zero.
- CoVe on every non-trivial function: draft → verify questions → check → revise.
- The WhatsApp SecureSessionStore uses the SAME master key as the credential vault.
- Performance benchmarks are tests, not just logs — they must assert thresholds.'

claude --dangerously-skip-permissions --model opus -p "$PROMPT"