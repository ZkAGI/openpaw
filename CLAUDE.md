# OpenPaw — Secure Agent Infrastructure

Security-first wrapper for AI agents. Monorepo: pnpm + turborepo.

## Architecture (6 Security Layers)
1. TEE Vault — AES-256-GCM local → Oasis Sapphire TEE
2. Skill Scanner — AST analysis, quarantine engine
3. MCP Proxy — credential injection, response redaction, policy engine
4. Lightpanda Browser — zero-state sandboxed browsing
5. ZK Proofs — Circom + Groth16 (~500 constraints, <100ms)
6. Solana Audit Trail — on-chain via alt_bn128 precompile

## Commands
- `pnpm build` — build all packages
- `pnpm test` — run all tests (vitest)
- `pnpm lint` — eslint + prettier check
- `pnpm test:e2e` — end-to-end with real endpoints

## IMPORTANT: ZK Stack
YOU MUST use Circom + Groth16. NOT SP1. NOT RISC Zero. NOT any zkVM.
3 circuits: instruction_match (~200), policy_check (~150), credential_proof (~150).
snarkjs for proving. circomlib for primitives. alt_bn128 for Solana verification.

## IMPORTANT: No Mocks in Tests
All tests MUST hit real code paths. No mock data. No simulated endpoints.
Use vitest with real function calls. E2E tests use real services.
Integration tests against real Solana devnet, real WebSocket connections.

## IMPORTANT: CoVe Verification
Before committing, verify your own output:
1. List 3 verification questions about the code you just wrote
2. Answer each independently
3. Fix inconsistencies before committing

## Code Style
- TypeScript strict, ESM modules
- Zod for validation
- Vitest for testing
- No relative imports crossing package boundaries

## Monorepo
@docs/ARCHITECTURE.md for full package map
@docs/IMPLEMENTATION_PLAN.md for sprint tasks
