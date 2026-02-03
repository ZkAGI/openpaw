# OpenPaw V1 — 10-Hour Sprint

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
