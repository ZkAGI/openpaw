---
name: cove-verify
description: Chain-of-Verification for code quality. Activates when writing, editing, or testing code.
---

# CoVe Verification Protocol

After implementing any feature, BEFORE committing:

## Step 1: Draft Complete
Confirm the implementation compiles and basic structure is correct.

## Step 2: Generate Verification Questions
Create 3-5 questions that check your own code:
- "Does this function handle edge cases (null, empty, overflow)?"
- "Are all error paths tested with real assertions?"
- "Does this match the interface contract in the types?"
- "Will this work with real data, not just happy-path inputs?"
- "Are there any hardcoded values that should be configurable?"

## Step 3: Execute Verification
Answer each question by ACTUALLY CHECKING THE CODE. Read the file.
Run the specific test. Check the type signature. Do not guess.

## Step 4: Revise
Fix every issue found. Re-run tests. Only then commit.

## CRITICAL
- Tests MUST use real function calls, NOT mocks
- If a test requires external services, use devnet/testnet
- Verification questions must be SPECIFIC to the code written
- Generic questions ("is it good?") are not verification
