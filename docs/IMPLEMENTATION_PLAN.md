<!-- # OpenPaw V1 — 10-Hour Sprint

Each task has: what to build, acceptance test, CoVe verification.

## Hour 0-1: Foundation
- [ ] Initialize turborepo monorepo with pnpm workspaces
  - Verify: `pnpm build` succeeds, `pnpm test` runs (even if empty)
- [ ] Create packages/ structure (cli, detect, vault, scanner, migrate, mcp-proxy, gateway, channels/*, zk-prover, solana, dashboard)
  - Verify: each package has package.json, tsconfig.json, src/index.ts
- [ ] Shared configs: tsconfig.base.json, .eslintrc.cjs, vitest.config.ts
  - Verify: `pnpm lint` and `pnpm test` pass from root
- [ ] CLI entry point: `openpaw --help` shows all commands
  - Verify: `npx tsx packages/cli/src/index.ts --help` outputs help text

## Hour 1-2: Detect + Vault
- [ ] packages/detect — scan directory, report installed agents
  - Verify: scan a temp dir with mock agent files, get structured JSON output
- [ ] packages/vault — AES-256-GCM encrypt/decrypt with real crypto
  - Verify: encrypt "test-api-key", decrypt, assert equality
  - Benchmark: encrypt + decrypt < 5ms
- [ ] packages/vault — reference ID generation (cred_{service}_{type}_{hash})
  - Verify: generate ID, parse back, components match
- [ ] packages/vault — secure wipe (overwrite with random bytes + unlink)
  - Verify: write file, wipe, confirm file gone AND content overwritten
- [ ] CLI: `openpaw vault import`, `openpaw vault list`, `openpaw vault get`
  - Verify: full round-trip via CLI subprocess spawn

## Hour 2-4: Scanner
- [ ] packages/scanner — TypeScript/JavaScript AST parser
  - Verify: parse real .ts file, extract function names, verify AST structure
- [ ] packages/scanner — security rules (fetch, eval, process.env, child_process)
  - Verify: scan fixture file containing each pattern, all detected
- [ ] packages/scanner — severity engine (CRITICAL/HIGH/MEDIUM/LOW)
  - Verify: eval() → CRITICAL, fetch() → HIGH, console.log → LOW
- [ ] packages/scanner — quarantine system (move + lock flagged files)
  - Verify: quarantine file, verify moved, verify locked, verify restore works
- [ ] CLI: `openpaw scan` with colored terminal output
  - Verify: scan test fixtures, output contains ANSI color codes + findings

## Hour 4-5.5: Migration
- [ ] packages/migrate — workspace copy (AGENTS.md, SOUL.md, etc.)
  - Verify: create source dir, run migrate, all files present in destination
- [ ] packages/migrate — session encryption (.jsonl → encrypted .jsonl.enc)
  - Verify: encrypt real .jsonl, decrypt, content matches original
- [ ] packages/migrate — config translation (openclaw.json → openpaw.json)
  - Verify: translate real config fixture, all fields mapped correctly
- [ ] CLI: `openpaw migrate --from openclaw` end-to-end
  - Verify: full migration of test workspace, all artifacts present

## Hour 5.5-7.5: MCP Proxy
- [ ] packages/mcp-proxy — JSON-RPC stdio server (real stdio streams)
  - Verify: spawn server, send JSON-RPC request via stdin, get response on stdout
- [ ] packages/mcp-proxy — tool passthrough with credential injection
  - Verify: tool call with ref_id, real credential injected, tool executed
- [ ] packages/mcp-proxy — response redaction (scan for leaked tokens)
  - Verify: response containing "sk-abc123" returns "[REDACTED]" instead
- [ ] packages/mcp-proxy — policy engine (rate limits, blocked tools)
  - Verify: exceed rate limit, get 429-equivalent response
- [ ] packages/mcp-proxy — audit logging with real file writes
  - Verify: make tool calls, read audit log, all entries present with timestamps

## Hour 7.5-9: Gateway + Channels
- [ ] packages/gateway — WebSocket server on :18789 (real WS)
  - Verify: connect with real WebSocket client, send message, get echo
- [ ] packages/gateway — session manager with encryption at rest
  - Verify: create session, restart server, session restored from disk
- [ ] packages/channels/whatsapp — Baileys adapter interface
  - Verify: adapter implements ChannelAdapter, message parse/format works
- [ ] packages/channels/telegram — grammY adapter interface
  - Verify: adapter implements ChannelAdapter, Telegram message format correct
- [ ] Message routing: channel → gateway → response pipeline
  - Verify: send message via WS, routed through pipeline, response received

## Hour 9-10: Polish + Ship
- [ ] `openpaw status` — show running services, vault stats, scan results
  - Verify: command outputs structured status JSON
- [ ] `openpaw doctor` — check dependencies, permissions, configs
  - Verify: run doctor, all checks reported with PASS/FAIL
- [ ] Error handling: every async function has proper error paths
  - Verify: reviewer agent scans for unhandled promises
- [ ] README.md with real install → migrate → start workflow
  - Verify: follow README steps on clean env, it works
- [ ] package.json configured for npm publish
  - Verify: `npm pack --dry-run` succeeds, tarball contains expected files

## Post-Sprint: ZK Stack (D+2 to D+4)
- [ ] Install circom compiler from source (cargo build)
- [ ] circuits/instruction_match.circom — Poseidon hash comparison
  - Verify: compile, constraint count ~200, test with circom_tester
- [ ] circuits/policy_check.circom — LessThan range proof
  - Verify: compile, constraint count ~150, test valid/invalid ranges
- [ ] circuits/credential_proof.circom — MerkleProof inclusion
  - Verify: compile, constraint count ~150, test with real merkle tree
- [ ] Groth16 trusted setup (zkey + verification key)
  - Verify: setup completes, verification key exports as JSON
- [ ] prover.ts — snarkjs wrapper with real prove/verify
  - Verify: generate proof, verify it, assert valid
  - Benchmark: prove < 100ms, verify < 50ms
- [ ] Integration: MCP proxy generates proof per tool call
  - Verify: make tool call through proxy, proof attached to audit log

## Post-Sprint: Solana (D+5 to D+7)
- [ ] programs/audit_trail — Anchor program on devnet
  - Verify: deploy to devnet, submit proof hash, read it back
- [ ] programs/reputation — on-chain agent score
  - Verify: submit multiple proofs, score increments correctly
- [ ] Groth16 verifier via alt_bn128 precompile
  - Verify: submit real proof on-chain, verification succeeds
- [ ] x402 payment handler
  - Verify: process test payment on devnet
- [ ] FROST 2-of-2 threshold signing
  - Verify: key generation, partial sign, combine, verify signature

## Day 1 Fix: Real OpenClaw Integration
- [ ] packages/scanner — scanCredentials() for .json .env .yaml .txt files detecting patterns: /sk-[a-zA-Z0-9]{20,}/, /AIza[a-zA-Z0-9_-]{35}/, /sk-or-v1-[a-f0-9]{64}/, /ghp_[a-zA-Z0-9]{36}/, /xoxb-[0-9-]+/, /AKIA[A-Z0-9]{16}/
  - Verify: scan fixture .json with plaintext keys, all detected with file+line+masked value
- [ ] packages/scanner — scanDirectory() runs credential scan on non-ts/js files alongside AST scan
  - Verify: directory with both .ts and .json files, both scanned, findings combined
- [ ] packages/migrate — migrateCredentials() reads auth-profiles.json from ~/.openclaw/agents/*/agent/, imports keys to vault, rewrites with "openpaw:vault:<id>" references, backs up to .bak
  - Verify: create fixture auth-profiles.json with real key format, migrate, verify .bak exists, verify rewritten file has vault references, verify vault contains imported credentials
- [ ] packages/cli — migrate command calls migrateCredentials() after workspace copy
  - Verify: openpaw migrate --from openclaw processes auth-profiles.json
- [ ] packages/cli — scan command runs credential scanner on all file types
  - Verify: openpaw scan on directory with .json containing API keys reports findings -->



# OpenPaw V2 Integration Plan — WhatsApp → Channels → Encryption → Backup → Oasis

## Current State (V1.0.9 shipped)

What WORKS today:
- ✅ AES-256-GCM credential vault (auth-profiles.json → encrypted vault)
- ✅ Env var injection (decrypt in RAM, set env var, spawn OpenClaw)
- ✅ 9-pattern skill scanner + quarantine
- ✅ Token redaction on responses
- ✅ MCP proxy (credential injection)
- ✅ Telegram adapter (basic)
- ✅ 170+ tests, 14 packages, live on npm

What's NOT done:
- ❌ WhatsApp adapter (Baileys encrypted session)
- ❌ Discord/Slack/Teams adapters
- ❌ Session encryption (.jsonl files)
- ❌ Memory encryption (MEMORY.md, daily logs)
- ❌ Backup/restore
- ❌ Oasis ROFL TEE integration
- ❌ Circom + Groth16 ZK proofs
- ❌ FROST 2-of-3 threshold

## ZK Stack Decision: Circom + Groth16 (NOT SP1)
Update ALL references in Day 1 slides (slide 11) from "SP1 zkVM" to "Circom + Groth16".

---

## PHASE 1: WhatsApp Adapter (Priority — do THIS first)

### The Problem
OpenClaw uses Baileys (unofficial WhatsApp Web protocol). Baileys stores 20+
session files at `~/.openclaw/credentials/baileys/<accountId>/` — encryption keys,
noise keys, pre-keys, sender keys. These files are READ/WRITTEN CONTINUOUSLY
while connected (key ratcheting). You can't encrypt individual files — Baileys
would crash.

### The Solution: "Tarball at Rest"

```
ON DISK (encrypted):
  ~/.openpaw/channels/whatsapp/<accountId>.vault
  → Single AES-256-GCM encrypted file
  → Contains packed directory of all Baileys files

IN RAM (decrypted, only while running):
  /tmp/openpaw-wa-<random>/
  ├── creds.json
  ├── app-state-sync-key-*.json
  ├── pre-key-*.json
  └── sender-key-memory-*.json
```

Lifecycle:
1. `openpaw start` → decrypt vault → extract to tmpfs → point Baileys here
2. Running → Baileys reads/writes normally in RAM
3. Every 5 min → re-encrypt RAM → disk (crash protection)
4. `openpaw stop` → final flush → wipe RAM directory

### Files to Add

Copy these files into your monorepo:

```
packages/channels/whatsapp/
├── src/
│   ├── index.ts                    ← exports
│   ├── secure-session-store.ts     ← THE CORE: tarball-at-rest encryption
│   └── adapter.ts                  ← WhatsApp ChannelAdapter + migration helper
├── __tests__/
│   ├── secure-session-store.test.ts ← full lifecycle tests (real crypto, real I/O)
│   └── adapter.test.ts             ← message parsing with real Baileys fixtures
└── package.json
```

### Claude Code Agent Prompt (for feat/whatsapp branch)

```
Read CLAUDE.md for project context.

You are adding WhatsApp support to OpenPaw. Your scope:
- packages/channels/whatsapp/

NEW FILES PROVIDED (already in the branch):
- src/secure-session-store.ts — "tarball at rest" encrypted session storage
- src/adapter.ts — WhatsApp ChannelAdapter using Baileys
- __tests__/secure-session-store.test.ts — real crypto, real I/O tests
- __tests__/adapter.test.ts — real Baileys message fixture tests

YOUR TASKS:
1. Fix the duplicate `import * as crypto` in adapter.ts (line ~260 has a
   redundant import — the crypto import should only be at the top or use
   a different approach for randomUUID)
2. Run pnpm install in the whatsapp package
3. Run pnpm test — fix ANY failing tests
4. Wire into packages/cli:
   - `openpaw migrate --from openclaw` should now also call migrateWhatsAppSession()
   - `openpaw start` should initialize WhatsAppAdapter if whatsapp channel is configured
5. Wire into packages/gateway:
   - Gateway should load WhatsAppAdapter alongside TelegramAdapter
   - Route messages from WhatsApp through the same MCP proxy pipeline
6. Add config support in openpaw.json:
   {
     "channels": {
       "whatsapp": {
         "selfChatMode": true,
         "dmPolicy": "allowlist",
         "allowFrom": ["+15551234567"]
       }
     }
   }
7. Test the full flow:
   - Create fake ~/.openclaw/ with Baileys session
   - Run openpaw migrate --from openclaw
   - Verify whatsapp vault file created
   - Run openpaw start (will fail without real WhatsApp — that's OK)
   - Verify secure session store opens and points Baileys to RAM dir

IMPORTANT RULES:
- ALL tests use real crypto, real files, real I/O. NO MOCKS.
- Circom + Groth16 for ZK. Never SP1.
- The adapter.ts has a bug: duplicate crypto import. Fix it.
- WhatsApp sessions are DIRECTORIES, not single files. The secure-session-store
  handles this by packing the directory into a single encrypted blob.

When all tests pass: say DONE.
```

### Migration Integration

In packages/cli, the migrate command should be updated:

```typescript
// In migrate command handler (packages/cli/src/commands/migrate.ts)

import { migrateWhatsAppSession } from "@openpaw/whatsapp";

// After existing credential migration:
console.log("Migrating WhatsApp sessions...");
const waResult = await migrateWhatsAppSession({
  openclawDir: path.join(os.homedir(), ".openclaw"),
  openpawDir: path.join(os.homedir(), ".openpaw"),
  masterKey: vaultMasterKey,
  wipeOriginal: flags.wipe ?? false,
});

if (waResult.found) {
  console.log(`  ✓ WhatsApp: ${waResult.fileCount} session files encrypted`);
} else {
  console.log("  ⊘ No WhatsApp session found");
}
```

---

## PHASE 2: Discord + Slack Adapters (simple — token-based)

These are straightforward because they use single bot tokens (like Telegram).

### Discord
```
packages/channels/discord/
├── src/
│   ├── index.ts
│   └── adapter.ts        ← Uses discord.js, bot token from vault
└── __tests__/
    └── adapter.test.ts   ← Parse Discord.Message fixtures
```

Migration: `DISCORD_BOT_TOKEN` from env/config → encrypt in vault → inject as env var.
Same pattern as Telegram.

### Slack
```
packages/channels/slack/
├── src/
│   ├── index.ts
│   └── adapter.ts        ← Uses @slack/bolt, bot token from vault
└── __tests__/
    └── adapter.test.ts   ← Parse Slack event fixtures
```

Migration: `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` → vault → env var.

### Claude Code Agent Prompt (for feat/channels-discord-slack branch)

```
Read CLAUDE.md for project context.

You are adding Discord and Slack channel adapters. Your scope:
- packages/channels/discord/
- packages/channels/slack/

Both adapters follow the same ChannelAdapter interface as WhatsApp and Telegram.
Both use token-based auth (like Telegram), NOT session directories (like WhatsApp).

For Discord:
- Use discord.js types for message parsing
- parseIncoming: Discord.Message → IncomingMessage
- formatOutgoing: ChannelMessage → Discord MessageCreateOptions
- Test with real Discord.Message fixture objects

For Slack:
- Use @slack/bolt types for event parsing
- parseIncoming: Slack MessageEvent → IncomingMessage
- formatOutgoing: ChannelMessage → Slack chat.postMessage params
- Test with real Slack event fixture objects

Migration (both):
- Token is already in vault via existing credential migration
- Inject as env var (DISCORD_BOT_TOKEN, SLACK_BOT_TOKEN)
- No special session handling needed

ALL tests use real fixtures, no mocks.
When all tests pass: say DONE.
```

---

## PHASE 3: Session + Memory Encryption

Extend the vault's AES-256-GCM to cover ALL sensitive files, not just credentials.

### What to encrypt:

| File | Location | Treatment |
|------|----------|-----------|
| Session .jsonl | agents/*/sessions/*.jsonl | Encrypt per-file → .jsonl.enc |
| MEMORY.md | workspace/MEMORY.md | Encrypt at rest |
| Daily memory | workspace/memory/*.md | Encrypt at rest |
| Audit log | .openpaw/audit.jsonl | Hash-chain entries for tamper detection |

### Implementation

```typescript
// packages/vault/src/file-encryptor.ts

export async function encryptFile(
  sourcePath: string,
  destPath: string,
  masterKey: Buffer
): Promise<void> {
  const data = await fsp.readFile(sourcePath);
  const blob = encrypt(data, masterKey);
  await fsp.writeFile(destPath, JSON.stringify(blob));
}

export async function decryptFile(
  sourcePath: string,
  masterKey: Buffer
): Promise<Buffer> {
  const raw = await fsp.readFile(sourcePath, "utf-8");
  const blob = JSON.parse(raw);
  return decrypt(blob, masterKey);
}
```

The gateway loads sessions by: read .jsonl.enc → decrypt in memory → parse JSONL → feed to agent context.
On save: serialize → encrypt → write .jsonl.enc.

---

## PHASE 4: Backup & Recovery

### Step A: Local encrypted backup (no blockchain needed)

```bash
openpaw backup --export backup.openpaw.enc
# Prompts for passphrase
# Creates: vault + sessions + memory + workspace → tar.gz → AES-256-GCM with passphrase

openpaw restore --from backup.openpaw.enc
# Prompts for passphrase
# Extracts everything back to ~/.openpaw/
```

The passphrase is SEPARATE from the master key. It's scrypt-derived.
This solves the "master key lost = unrecoverable" limitation from Day 1.

### Step B: Auto cloud backup (optional)

```bash
openpaw backup --cloud --provider s3
# Client-side encrypted BEFORE upload
# Storage provider sees only encrypted blob
```

---

## PHASE 5: Oasis ROFL Integration (2-of-3 threshold)

### Architecture

```
SHARE 1: Device (local, in ~/.openpaw/device.share)
SHARE 2: Oasis Sapphire TEE (in OpenPawVault.sol confidential contract)
SHARE 3: Encrypted backup (user holds passphrase-protected share)

Any 2 of 3 → reconstruct master key
```

### Not 100% Oasis dependent

This is key: OpenPaw WORKS WITHOUT Oasis. The local vault (AES-256-GCM with
machine-derived key) is the fallback. Oasis is an UPGRADE, not a requirement.

```
Level 0: Plaintext (OpenClaw)         ← what users have now
Level 1: Local AES-256-GCM (OpenPaw V1) ← what we shipped
Level 2: 2-of-3 threshold (OpenPaw V2)  ← Oasis upgrade
Level 3: ROFL TEE runtime (OpenPaw V3)  ← full enclave
```

### Implementation order:

1. Deploy OpenPawVault.sol on Sapphire testnet (fork PawPadVault.sol)
2. Store master key TEE share in confidential contract
3. `openpaw start` tries: TEE share + device share → reconstruct
4. Falls back to: device share + backup share if TEE unavailable
5. Falls back to: local-only key if neither TEE nor backup available

### Contracts

```solidity
// contracts/OpenPawVault.sol (on Sapphire — confidential EVM)

contract OpenPawVault {
    // Confidential: stored encrypted in Sapphire's TEE
    mapping(address => bytes) private teeShares;
    mapping(address => bytes32) private policyHashes;

    function storeShare(bytes calldata share) external {
        teeShares[msg.sender] = share;
    }

    function retrieveShare() external view returns (bytes memory) {
        // Only callable by the owner — Sapphire ensures confidentiality
        return teeShares[msg.sender];
    }

    function setPolicy(bytes32 hash) external {
        policyHashes[msg.sender] = hash;
    }
}
```

---

## PHASE 6: Circom + Groth16 ZK Proofs

Circuits:
- IntentVerify.circom (~200 constraints) — Poseidon hash comparison
- PolicyCheck.circom (~150 constraints) — LessThan range proof
- CredentialProof.circom (~150 constraints) — MerkleProof inclusion

Integration: MCP proxy generates proof per tool call → audit log + optional Solana submission.

---

## Branch Strategy (for parallel Claude Code agents)

```
main
├── feat/whatsapp         ← FIRST PRIORITY (this document's focus)
├── feat/discord-slack    ← After WhatsApp works
├── feat/file-encryption  ← Session + memory encryption
├── feat/backup           ← Backup/restore CLI
├── feat/oasis-vault      ← Sapphire contract + share storage
└── feat/zk-circuits      ← Circom + Groth16
```

Each branch gets its own Claude Code agent with a specific prompt.
Merge order: whatsapp → discord-slack → file-encryption → backup → oasis → zk.
Each branch builds on the previous.

---

## Quick Reference: What's in the WhatsApp Code

### secure-session-store.ts
- `packDirectory()` / `unpackToDirectory()` — custom binary format (no tar dependency)
- `encrypt()` / `decrypt()` — AES-256-GCM matching existing vault
- `SecureSessionStore` class:
  - `open()` — decrypt vault → extract to tmpfs → start flush timer
  - `flush()` — re-encrypt tmpfs → disk (every 5 min + on close)
  - `close()` — final flush → secure wipe tmpfs
  - `importFromPlaintext()` — import existing Baileys directory
  - `migrateFromOpenClaw()` — find + import + optionally wipe OpenClaw session

### adapter.ts
- `WhatsAppAdapter` — implements ChannelAdapter interface
- `parseIncoming()` — Baileys message → IncomingMessage
- `formatOutgoing()` — ChannelMessage → Baileys send format
- `migrateWhatsAppSession()` — standalone migration helper for CLI
- Policy: selfChatMode, dmPolicy (allowlist/open), allowFrom list

### Tests (25 tests total)
- 10 tests for SecureSessionStore (lifecycle, encryption, migration, perf)
- 15 tests for adapter (parsing, formatting, interface compliance)
- ALL real crypto, real files, real I/O. Zero mocks.