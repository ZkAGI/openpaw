# OpenPaw

Security-first wrapper for AI agents. Provides encrypted credential management, security scanning, and policy enforcement.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run doctor to check your environment
npx openpaw doctor
```

## CLI Commands

### Vault (Credential Management)

```bash
# Import a credential
openpaw vault import --service openai --type api_key --value sk-...

# List stored credentials
openpaw vault list
openpaw vault list --json

# Get a credential by ID
openpaw vault get cred_openai_api_key_a1b2c3d4

# Delete a credential
openpaw vault delete cred_openai_api_key_a1b2c3d4
```

### Detect (Agent Discovery)

```bash
# Scan current directory for AI agents
openpaw detect

# Scan a specific directory
openpaw detect /path/to/project

# Output as JSON
openpaw detect --json
```

### Scan (Security Analysis)

```bash
# Scan for security issues
openpaw scan

# Scan a specific directory
openpaw scan /path/to/project

# Output as JSON
openpaw scan --json
```

### Migrate

```bash
# Migrate from another agent framework
openpaw migrate --from openclaw --source ./old-project --dest ./new-project
```

### Status

```bash
# Show running services and vault stats
openpaw status
openpaw status --json
```

### Doctor

```bash
# Check dependencies, permissions, and configuration
openpaw doctor
openpaw doctor --json
```

## Architecture

OpenPaw uses 6 security layers:

1. **TEE Vault** - AES-256-GCM local encryption (future: Oasis Sapphire TEE)
2. **Skill Scanner** - AST analysis for security issues
3. **MCP Proxy** - Credential injection and response redaction
4. **Lightpanda Browser** - Zero-state sandboxed browsing
5. **ZK Proofs** - Circom + Groth16 (~500 constraints, <100ms)
6. **Solana Audit Trail** - On-chain via alt_bn128 precompile

## Development

```bash
# Run tests
pnpm test

# Run linting
pnpm lint

# Format code
pnpm format

# Type checking
pnpm typecheck
```

## Packages

- `@openpaw/cli` - Command-line interface
- `@openpaw/vault` - Encrypted credential storage
- `@openpaw/detect` - Agent detection
- `@openpaw/scanner` - Security scanning
- `@openpaw/migrate` - Framework migration
- `@openpaw/mcp-proxy` - MCP protocol proxy
- `@openpaw/gateway` - WebSocket gateway
- `@openpaw/zk-prover` - ZK proof generation (Circom + Groth16)
- `@openpaw/solana` - Solana integration
- `@openpaw/dashboard` - Status dashboard
- `@openpaw/channel-*` - Channel adapters (WhatsApp, Telegram, Slack, Discord)

## License

ISC
