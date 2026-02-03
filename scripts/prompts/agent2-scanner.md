Read CLAUDE.md for project context.

You are Agent 2. You ONLY work on these packages:
- packages/scanner
- packages/migrate

IMPORTANT: Do NOT edit any files outside these 2 packages.
Do NOT edit CLAUDE.md, root package.json, pnpm-workspace.yaml, or docs/.

## Tasks

### packages/scanner
- TypeScript/JavaScript AST parser
- Use @typescript-eslint/typescript-estree for parsing
- Security rules to detect: fetch(), eval(), process.env access,
  child_process/exec imports, dynamic require(), fs.writeFile to sensitive paths
- Severity engine: eval/exec → CRITICAL, fetch/child_process → HIGH,
  process.env → MEDIUM, console.log → LOW
- Quarantine: move flagged file to .quarantine/ dir, create lock file
- Restore: move back from quarantine, remove lock
- Test: create real .ts fixture files containing each dangerous pattern
- Test: scan fixtures, verify ALL patterns detected with correct severity
- Test: quarantine a file, verify moved, restore, verify back
- Benchmark: scan 10 files < 500ms

### packages/migrate
- Copy workspace files (AGENTS.md, SOUL.md, config files)
- Session encryption: read .jsonl, encrypt with AES-256-GCM, write .jsonl.enc
- Config translation: parse openclaw.json → generate openpaw.json
- Test: create source workspace dir with real files, migrate, verify all present
- Test: encrypt real .jsonl content, decrypt, verify match
- Test: translate fixture openclaw.json, verify all fields mapped

## Rules
- ALL tests use real function calls. No vi.mock for business logic.
- Use vitest.
- Commit after each package is complete with passing tests.
