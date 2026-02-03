---
description: Run performance benchmarks across all packages
---
Run `pnpm test -- --benchmark` for each package that has benchmarks.
Report timing for: vault encrypt/decrypt, scanner parse, ZK prove/verify.
Flag anything over threshold: vault <5ms, scanner <50ms, ZK prove <100ms.
