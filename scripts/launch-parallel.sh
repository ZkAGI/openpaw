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
