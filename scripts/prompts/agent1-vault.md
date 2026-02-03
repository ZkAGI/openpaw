Read CLAUDE.md for project context.

You are Agent 1. You ONLY work on these packages:
- packages/cli
- packages/detect
- packages/vault

IMPORTANT: Do NOT edit any files outside these 3 packages.
Do NOT edit CLAUDE.md, root package.json, pnpm-workspace.yaml, or docs/.

## Tasks

### packages/detect
- Scan a directory for installed AI agent configs
- Return structured JSON: { agents: [{ name, path, configFiles }] }
- Test: create temp dir with fake agent files, scan, verify JSON output

### packages/vault
- AES-256-GCM encryption using Node.js crypto module (REAL crypto)
- encrypt(plaintext, key) → { iv, ciphertext, tag }
- decrypt({ iv, ciphertext, tag }, key) → plaintext
- Reference ID generation: cred_{service}_{type}_{first4charsOfHash}
- Secure wipe: overwrite file with crypto.randomBytes then fs.unlink
- Test: encrypt "sk-test-key-12345", decrypt, assert match
- Test: generate ref ID, parse components back, verify
- Test: write temp file, wipe, verify file gone
- Benchmark: encrypt+decrypt cycle < 5ms

### packages/cli
- Entry point using commander.js
- Commands: openpaw --help, vault import, vault list, vault get,
  scan, detect, migrate, start, stop, status, doctor
- Wire vault commands to real vault functions
- Wire detect command to real detect function
- Test: spawn CLI as child process, verify --help output
- Test: vault import → vault list → vault get round-trip via CLI

## Rules
- ALL tests use real function calls. No vi.mock for business logic.
- Use vitest. Tests must pass: pnpm test --filter=@openpaw/cli --filter=@openpaw/detect --filter=@openpaw/vault
- Commit after each package is complete with passing tests.
- After ALL 3 packages done, run full test suite one more time.
