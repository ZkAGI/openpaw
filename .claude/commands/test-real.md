---
description: Run tests and verify no mocks are used
---
Run `pnpm test` with verbose output.
Then grep all test files for vi.mock, jest.mock, sinon, and nock.
Report any mock usage found with file paths.
Tests must use real function calls only.
