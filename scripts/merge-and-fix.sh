#!/usr/bin/env bash
set -euo pipefail

cd "/Users/ankitasahu/Developer/ZkAGI/openpaw"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Merging All Feature Branches Into Main"
echo "═══════════════════════════════════════════════════"
echo ""

git checkout master

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
    AHEAD=$(git rev-list master.."$branch" --count 2>/dev/null || echo "0")
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
