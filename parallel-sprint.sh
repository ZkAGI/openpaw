#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# OpenPaw Parallel Sprint Launcher
# ═══════════════════════════════════════════════════════════════
#
# HOW TO USE:
# 1. Wait for your foundation prompt to finish in Claude Code
# 2. Exit Claude Code: type /exit or press Ctrl+C
# 3. Run: chmod +x parallel-sprint.sh && ./parallel-sprint.sh
#
# This script:
#   - Commits the foundation
#   - Creates 4 git branches
#   - Opens 4 terminal tabs with Claude Code on each branch
#   - Each agent only touches its own packages
#   - After all finish: run ./merge-and-fix.sh
#
# REQUIRES: macOS Terminal or iTerm2
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_DIR="/Users/ankitasahu/Developer/ZkAGI/openpaw"
cd "$PROJECT_DIR"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  OpenPaw Parallel Sprint Setup"
echo "═══════════════════════════════════════════════════"
echo ""

# ──────────────────────────────────────────────────────
# STEP 1: Commit foundation (if not already committed)
# ──────────────────────────────────────────────────────
echo "━━━ Step 1: Committing foundation ━━━"
git add -A
git commit -m "chore: monorepo foundation" 2>/dev/null || echo "Already committed or nothing to commit"
echo "✓ Foundation committed on main"
echo ""

# ──────────────────────────────────────────────────────
# STEP 2: Create branches
# ──────────────────────────────────────────────────────
echo "━━━ Step 2: Creating feature branches ━━━"
git branch feat/vault-detect-cli   2>/dev/null || echo "  feat/vault-detect-cli already exists"
git branch feat/scanner-migrate    2>/dev/null || echo "  feat/scanner-migrate already exists"
git branch feat/mcp-gateway        2>/dev/null || echo "  feat/mcp-gateway already exists"
git branch feat/channels           2>/dev/null || echo "  feat/channels already exists"
echo "✓ All 4 branches created"
echo ""

# ──────────────────────────────────────────────────────
# STEP 3: Create the merge + conflict resolution script
# ──────────────────────────────────────────────────────
echo "━━━ Step 3: Creating merge script ━━━"

cat > "$PROJECT_DIR/scripts/merge-and-fix.sh" << 'MERGE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

cd "/Users/ankitasahu/Developer/ZkAGI/openpaw"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Merging All Feature Branches Into Main"
echo "═══════════════════════════════════════════════════"
echo ""

git checkout main

BRANCHES=(
    "feat/vault-detect-cli"
    "feat/scanner-migrate"
    "feat/mcp-gateway"
    "feat/channels"
)

FAILED=()

for branch in "${BRANCHES[@]}"; do
    echo ""
    echo "━━━ Merging: $branch ━━━"
    
    # Check if branch has commits ahead of main
    AHEAD=$(git rev-list main.."$branch" --count 2>/dev/null || echo "0")
    if [ "$AHEAD" = "0" ]; then
        echo "  ⊘ No new commits on $branch, skipping"
        continue
    fi
    echo "  $AHEAD commits to merge"

    if git merge "$branch" --no-edit 2>/dev/null; then
        echo "  ✓ Merged cleanly"
    else
        echo "  ⚠ Conflicts detected — auto-resolving..."
        
        # Get list of conflicted files
        CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null || true)
        
        for file in $CONFLICTS; do
            case "$file" in
                docs/IMPLEMENTATION_PLAN.md)
                    # For the plan: keep both versions (accept theirs, we'll reconcile)
                    echo "    Resolving $file → keeping incoming changes"
                    git checkout --theirs "$file"
                    git add "$file"
                    ;;
                CLAUDE.md)
                    # Keep ours (main's version)
                    echo "    Resolving $file → keeping main version"
                    git checkout --ours "$file"
                    git add "$file"
                    ;;
                package.json|pnpm-lock.yaml|pnpm-workspace.yaml)
                    # For root configs: keep ours, we'll fix deps after
                    echo "    Resolving $file → keeping main version"
                    git checkout --ours "$file"
                    git add "$file"
                    ;;
                packages/*)
                    # For package files: always accept incoming (the branch did the work)
                    echo "    Resolving $file → keeping branch changes"
                    git checkout --theirs "$file"
                    git add "$file"
                    ;;
                *)
                    # Default: accept incoming
                    echo "    Resolving $file → keeping branch changes"
                    git checkout --theirs "$file" 2>/dev/null || true
                    git add "$file" 2>/dev/null || true
                    ;;
            esac
        done
        
        git commit --no-edit 2>/dev/null || {
            echo "  ✗ Could not auto-resolve $branch"
            FAILED+=("$branch")
            git merge --abort 2>/dev/null || true
            continue
        }
        echo "  ✓ Merged with auto-resolved conflicts"
    fi
done

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Post-Merge: Fixing Dependencies"
echo "═══════════════════════════════════════════════════"
echo ""

# Reinstall deps in case any branch added packages
pnpm install 2>/dev/null || echo "pnpm install had issues — check manually"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Post-Merge: Running Tests"
echo "═══════════════════════════════════════════════════"
echo ""

pnpm test 2>&1 || echo "⚠ Some tests failed — will fix with Ralph"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Post-Merge: Commit Merged State"
echo "═══════════════════════════════════════════════════"
echo ""

git add -A
git commit -m "chore: post-merge dependency fix" 2>/dev/null || echo "Nothing to commit"

if [ ${#FAILED[@]} -gt 0 ]; then
    echo ""
    echo "⚠ These branches had unresolvable conflicts:"
    for b in "${FAILED[@]}"; do
        echo "  - $b"
    done
    echo ""
    echo "Merge them manually: git merge <branch>"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ MERGE COMPLETE"
echo ""
echo "  Next steps:"
echo "  1. Review: git log --oneline -20"
echo "  2. Fix failures with Ralph:"
echo "     claude --dangerously-skip-permissions"
echo "     /ralph-loop \"Fix all failing tests. Ensure pnpm test"
echo "     passes. No mocks. If all pass, say DONE.\""
echo "     --max-iterations 20 --completion-promise \"DONE\""
echo "═══════════════════════════════════════════════════"
MERGE_SCRIPT

chmod +x "$PROJECT_DIR/scripts/merge-and-fix.sh"
echo "✓ Merge script created at scripts/merge-and-fix.sh"
echo ""

# ──────────────────────────────────────────────────────
# STEP 4: Create prompt files for each agent
# ──────────────────────────────────────────────────────
echo "━━━ Step 4: Creating agent prompts ━━━"
mkdir -p "$PROJECT_DIR/scripts/prompts"

cat > "$PROJECT_DIR/scripts/prompts/agent1-vault.md" << 'PROMPT1'
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
PROMPT1

cat > "$PROJECT_DIR/scripts/prompts/agent2-scanner.md" << 'PROMPT2'
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
PROMPT2

cat > "$PROJECT_DIR/scripts/prompts/agent3-mcp.md" << 'PROMPT3'
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
PROMPT3

cat > "$PROJECT_DIR/scripts/prompts/agent4-channels.md" << 'PROMPT4'
Read CLAUDE.md for project context.

You are Agent 4. You ONLY work on these packages:
- packages/channels/whatsapp
- packages/channels/telegram
- packages/channels/discord
- packages/channels/slack

IMPORTANT: Do NOT edit any files outside packages/channels/.
Do NOT edit CLAUDE.md, root package.json, pnpm-workspace.yaml, or docs/.

## Tasks

### Shared ChannelAdapter Interface (define in each package)
```typescript
interface ChannelAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: ChannelMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  parseIncoming(raw: unknown): IncomingMessage;
  formatOutgoing(msg: ChannelMessage): unknown;
}
```

### packages/channels/whatsapp
- Adapter using @whiskeysockets/baileys types
- parseIncoming: convert Baileys message format → IncomingMessage
- formatOutgoing: convert ChannelMessage → Baileys send format
- Test: parse a real Baileys message fixture, verify fields mapped
- Test: format outgoing, verify Baileys structure

### packages/channels/telegram
- Adapter using grammy types
- parseIncoming: convert Telegram Update → IncomingMessage
- formatOutgoing: convert ChannelMessage → Telegram sendMessage params
- Test: parse real Telegram Update fixture, verify fields
- Test: format outgoing, verify Telegram API structure

### packages/channels/discord
- Adapter using discord.js types
- parseIncoming: convert Discord Message → IncomingMessage
- formatOutgoing: convert ChannelMessage → Discord message options
- Test: parse real Discord message fixture, verify fields

### packages/channels/slack
- Adapter using @slack/bolt types
- parseIncoming: convert Slack event → IncomingMessage
- formatOutgoing: convert ChannelMessage → Slack blocks
- Test: parse real Slack event fixture, verify fields

## Rules
- Tests use real message fixture objects (actual API shapes), not mocks.
- Each adapter must implement the full ChannelAdapter interface.
- Commit each adapter separately with passing tests.
PROMPT4

echo "✓ Agent prompts created in scripts/prompts/"
echo ""

# ──────────────────────────────────────────────────────
# STEP 5: Create the parallel launcher
# ──────────────────────────────────────────────────────
echo "━━━ Step 5: Creating parallel launcher ━━━"

cat > "$PROJECT_DIR/scripts/launch-parallel.sh" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/ankitasahu/Developer/ZkAGI/openpaw"
cd "$PROJECT_DIR"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Launching 4 Parallel Claude Code Agents"
echo "═══════════════════════════════════════════════════"
echo ""

# Check if tmux is available (preferred for parallel terminals)
if command -v tmux &> /dev/null; then
    echo "Using tmux for parallel execution..."
    echo ""

    SESSION="openpaw-sprint"
    tmux kill-session -t "$SESSION" 2>/dev/null || true

    # Create tmux session with 4 panes
    tmux new-session -d -s "$SESSION" -n agents

    # Pane 0: Agent 1 — Vault+Detect+CLI (Opus)
    tmux send-keys -t "$SESSION:agents.0" \
        "cd $PROJECT_DIR && git checkout feat/vault-detect-cli && claude --dangerously-skip-permissions --model opus -p \"\$(cat scripts/prompts/agent1-vault.md)\"" Enter

    # Pane 1: Agent 2 — Scanner+Migrate (Sonnet)
    tmux split-window -h -t "$SESSION:agents"
    tmux send-keys -t "$SESSION:agents.1" \
        "cd $PROJECT_DIR && git checkout feat/scanner-migrate && claude --dangerously-skip-permissions --model sonnet -p \"\$(cat scripts/prompts/agent2-scanner.md)\"" Enter

    # Pane 2: Agent 3 — MCP+Gateway (Sonnet)
    tmux split-window -v -t "$SESSION:agents.0"
    tmux send-keys -t "$SESSION:agents.2" \
        "cd $PROJECT_DIR && git checkout feat/mcp-gateway && claude --dangerously-skip-permissions --model sonnet -p \"\$(cat scripts/prompts/agent3-mcp.md)\"" Enter

    # Pane 3: Agent 4 — Channels (Sonnet)
    tmux split-window -v -t "$SESSION:agents.1"
    tmux send-keys -t "$SESSION:agents.3" \
        "cd $PROJECT_DIR && git checkout feat/channels && claude --dangerously-skip-permissions --model sonnet -p \"\$(cat scripts/prompts/agent4-channels.md)\"" Enter

    # Even out the layout
    tmux select-layout -t "$SESSION:agents" tiled

    echo "✓ All 4 agents launched in tmux session: $SESSION"
    echo ""
    echo "To attach:  tmux attach -t $SESSION"
    echo "To detach:  Ctrl+B then D"
    echo "To kill:    tmux kill-session -t $SESSION"
    echo ""
    echo "After all agents finish:"
    echo "  git checkout main"
    echo "  ./scripts/merge-and-fix.sh"

    tmux attach -t "$SESSION"

else
    echo "tmux not found. Using macOS Terminal tabs..."
    echo ""
    echo "Opening 4 Terminal tabs..."

    # Agent 1
    osascript -e "
    tell application \"Terminal\"
        activate
        do script \"cd $PROJECT_DIR && git checkout feat/vault-detect-cli && claude --dangerously-skip-permissions --model opus -p \\\"\$(cat scripts/prompts/agent1-vault.md)\\\"\"
    end tell"

    sleep 2

    # Agent 2
    osascript -e "
    tell application \"Terminal\"
        activate
        do script \"cd $PROJECT_DIR && git checkout feat/scanner-migrate && claude --dangerously-skip-permissions --model sonnet -p \\\"\$(cat scripts/prompts/agent2-scanner.md)\\\"\"
    end tell"

    sleep 2

    # Agent 3
    osascript -e "
    tell application \"Terminal\"
        activate
        do script \"cd $PROJECT_DIR && git checkout feat/mcp-gateway && claude --dangerously-skip-permissions --model sonnet -p \\\"\$(cat scripts/prompts/agent3-mcp.md)\\\"\"
    end tell"

    sleep 2

    # Agent 4
    osascript -e "
    tell application \"Terminal\"
        activate
        do script \"cd $PROJECT_DIR && git checkout feat/channels && claude --dangerously-skip-permissions --model sonnet -p \\\"\$(cat scripts/prompts/agent4-channels.md)\\\"\"
    end tell"

    echo ""
    echo "✓ All 4 agents launched in separate Terminal windows"
    echo ""
    echo "After all agents finish:"
    echo "  git checkout main"
    echo "  ./scripts/merge-and-fix.sh"
fi
LAUNCHER

chmod +x "$PROJECT_DIR/scripts/launch-parallel.sh"
echo "✓ Parallel launcher created"
echo ""

# ──────────────────────────────────────────────────────
# STEP 6: Create the post-merge Ralph fixer
# ──────────────────────────────────────────────────────
echo "━━━ Step 6: Creating post-merge Ralph fixer ━━━"

cat > "$PROJECT_DIR/scripts/ralph-fix.sh" << 'RALPHFIX'
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
RALPHFIX

chmod +x "$PROJECT_DIR/scripts/ralph-fix.sh"
echo "✓ Post-merge fixer created"
echo ""

# ──────────────────────────────────────────────────────
# COMMIT EVERYTHING
# ──────────────────────────────────────────────────────
echo "━━━ Committing sprint scripts ━━━"
git add -A
git commit -m "chore: add parallel sprint scripts" 2>/dev/null || echo "Already committed"
echo ""

# ──────────────────────────────────────────────────────
# DONE — PRINT INSTRUCTIONS
# ──────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ SETUP COMPLETE"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  YOUR WORKFLOW (3 commands total):"
echo ""
echo "  STEP A — Launch 4 parallel agents:"
echo "    ./scripts/launch-parallel.sh"
echo ""
echo "  STEP B — After all 4 finish, merge:"
echo "    git checkout main"
echo "    ./scripts/merge-and-fix.sh"
echo ""
echo "  STEP C — Fix integration issues with Ralph:"
echo "    ./scripts/ralph-fix.sh"
echo ""
echo "  That's it. 3 commands. Day 1 done."
echo "═══════════════════════════════════════════════════"
