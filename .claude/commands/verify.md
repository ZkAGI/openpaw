---
description: Run Chain-of-Verification on recent changes
---
Review the last git commit. For each changed file:
1. Generate 3 verification questions specific to the changes
2. Answer each by reading the actual code and running relevant tests
3. If any answer reveals an issue, fix it and amend the commit
4. Report: file, question, answer, status (PASS/FAIL)
