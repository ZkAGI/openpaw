#!/usr/bin/env bash
set -euo pipefail

cd "/Users/ankitasahu/Developer/ZkAGI/openpaw"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Post-Merge Ralph Fixer"
echo "  Fixes integration issues + failing tests"
echo "═══════════════════════════════════════════════════"
echo ""

PROMPT='Read CLAUDE.md for project context.

All 4 feature branches have been merged. Your job:

1. Run pnpm install to sync dependencies
2. Run pnpm build — fix any build errors
3. Run pnpm test — fix any failing tests
4. Check imports between packages are correct (workspace refs)
5. Verify CLI wires to real vault/detect/scanner functions
6. Verify no test file uses vi.mock for business logic
7. Add openpaw status command (show running services + vault stats)
8. Add openpaw doctor command (check deps, permissions, configs)
9. Update README.md with install + usage instructions
10. When pnpm build && pnpm test && pnpm lint all pass: say DONE

Rules:
- ALL tests must use real function calls, no mocks
- Circom + Groth16 only for ZK references. Never SP1.
- Fix real issues, do not skip or disable tests'

claude --dangerously-skip-permissions --model opus -p "$PROMPT"
