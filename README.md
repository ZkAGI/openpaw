<p align="center">
  <img src="https://img.shields.io/npm/v/@sahu-01/openpaw?style=flat-square&color=22c55e" alt="npm version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="node" />
  <img src="https://img.shields.io/badge/typescript-5.x-3178c6?style=flat-square" alt="typescript" />
</p>

<h1 align="center">🐾 OpenPaw</h1>

<p align="center">
  <strong>Privacy-first security wrapper for OpenClaw AI agents.</strong><br/>
  Drop-in protection — same experience, cryptographic guarantees underneath.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#why-openpaw">Why OpenPaw</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#security-layers">Security Layers</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## Quick Start

Three commands. That's it.

```bash
npm install -g @sahu-01/openpaw

openpaw migrate --from openclaw

openpaw start
```

Your OpenClaw agent keeps working exactly as before — same channels, same personality, same skills — but now credentials are encrypted, tool calls are proxied, sessions are secured, and every action is auditable.

---

## Why OpenPaw

OpenClaw is the most popular open-source AI agent gateway, connecting LLMs to WhatsApp, Telegram, Discord, Slack, and more. But it stores **everything as plaintext**: API keys, OAuth tokens, conversation history, agent memory, daily logs — all sitting unencrypted on disk. Skills run unscanned. The browser tool uses your actual Chrome sessions. There's no access control on tool calls.

If an attacker gains disk access, or if the agent is tricked by a prompt injection, the damage is total and silent.

**OpenPaw fixes this without changing anything the user sees.** It's not a fork or a rewrite — it's a security layer that wraps OpenClaw's functionality while preserving the same port (18789), same channel adapters, same workspace structure, and same SKILL.md format.

### The Problem, Visualized

```
OpenClaw (unprotected):
  Channel → Agent → Tool (direct, unprotected)
  
  • Credentials stored as plaintext JSON
  • No scanning of third-party skills
  • Agent has unrestricted tool access
  • Sessions readable by anyone with disk access
  • No audit trail of agent actions
```

### The Fix

```
OpenPaw (secured):
  Channel → TEE Gateway → Agent (in enclave)
         → MCP Proxy (credential injection + policy engine)
         → ZK Attestation → Tool

  • Credentials encrypted with AES-256-GCM
  • Skills statically analyzed and quarantined if flagged
  • Every tool call proxied, rate-limited, and logged
  • Sessions encrypted at rest
  • Tamper-proof audit trail on Solana
```

---

## Architecture

OpenPaw is built as a TypeScript monorepo using pnpm workspaces and turborepo.

```
@zkagi/openpaw
├── packages/
│   ├── cli/            Commander.js entry point — all user-facing commands
│   ├── detect/         Scans directories for AI agent configurations
│   ├── vault/          AES-256-GCM credential encryption + reference IDs
│   ├── scanner/        AST-based skill security analysis + quarantine
│   ├── migrate/        One-command OpenClaw → OpenPaw migration engine
│   ├── mcp-proxy/      JSON-RPC 2.0 proxy — credential injection, redaction, rate limiting
│   ├── gateway/        WebSocket server on :18789 — encrypted sessions, channel routing
│   ├── whatsapp/       Baileys WhatsApp channel adapter
│   ├── telegram/       grammY Telegram channel adapter
│   ├── discord/        discord.js channel adapter
│   ├── slack/          @slack/bolt channel adapter
│   ├── zk-prover/      Circom + Groth16 zero-knowledge proof generation
│   ├── solana/         Anchor programs + on-chain audit verification
│   └── shared/         Shared types, config schema, utilities
├── circuits/
│   ├── IntentVerify.circom    Proves tool call matches user instruction
│   └── PolicyCheck.circom     Proves action is within policy constraints
└── tests/
    ├── e2e/            End-to-end integration tests
    └── fixtures/       Real OpenClaw directory structures for testing
```

### How a Message Flows Through OpenPaw

1. **Message arrives** on WhatsApp / Telegram / Discord / Slack
2. **OpenPaw Gateway** receives it on `ws://127.0.0.1:18789`
3. **MCP Proxy intercepts** — credentials replaced with reference IDs (`cred_gmail_oauth_a1b2`)
4. **Agent processes** the message — it never sees raw credentials
5. **LLM responds** with a tool call request
6. **MCP Proxy checks**: rate limits, policy constraints, credential patterns
7. **Groth16 prover** generates a ZK proof that the action is authorized
8. **Vault decrypts** the real credential server-side for the API call
9. **Token redaction** strips any leaked keys from the response (`sk-*` → `[REDACTED]`)
10. **Tool executes** within sandbox limits
11. **Audit log** records the action with timestamp and proof hash
12. **Response returns** to user through the channel

---

## Security Layers

### Layer 1 — Credential Vault (AES-256-GCM)

All API keys, OAuth tokens, and secrets are encrypted at rest. The agent never handles raw credentials — it only knows reference IDs like `cred_google_a1b2`. The vault decrypts server-side when the actual API call is made.

```bash
# Import a credential
openpaw vault import --service google --type api-key

# List stored credentials (shows reference IDs only, never plaintext)
openpaw vault list

# Securely delete (3-pass overwrite + unlink)
openpaw vault delete cred_google_api_a1b2
```

### Layer 2 — Skill Scanner

Before any skill runs, an AST parser reads the code and flags 9 categories of dangerous patterns: `fetch()` to external URLs, `fs.readFileSync` on credential paths, `eval()`, obfuscated code, `child_process` usage, and more. Flagged skills go to quarantine — you approve or reject.

```bash
# Scan a skills directory
openpaw scan ./skills

# Auto-quarantine flagged skills
openpaw scan ./skills --quarantine
```

### Layer 3 — MCP Proxy

A JSON-RPC 2.0 stdio server that sits between the agent and every tool. It intercepts every tool call, injects credentials so the agent never handles them directly, redacts sensitive data from responses, enforces rate limits and budget caps, sandboxes shell commands, and logs everything.

### Layer 4 — TEE Runtime (Oasis ROFL)

The entire gateway runs inside a hardware-sealed enclave. CPU encrypts all RAM — even root access on the host can't read agent memory. Remote attestation proves the enclave is running unmodified OpenPaw code.

### Layer 5 — ZK Attestation (Circom + Groth16)

Every tool call requires a zero-knowledge proof before execution. Two circuits handle this:

- **IntentVerify.circom** — proves the tool call matches the user's original instruction
- **PolicyCheck.circom** — proves the action is within policy constraints (rate limits, budget caps, allowed services)

Failed proof = action blocked. Even if an attacker crafts a prompt injection, the action can't pass attestation.

### Layer 6 — On-Chain Audit (Solana Anchor)

Hash commitments of every action are logged on Solana. Private but verifiable — anyone can confirm an action happened without seeing the contents. This creates a tamper-proof record that kills deniability.

---

## CLI Reference

| Command | Description |
|---|---|
| `openpaw detect [path]` | Scan a directory for AI agent configurations |
| `openpaw vault import --service <s> --type <t>` | Import a credential into the encrypted vault |
| `openpaw vault list [--json]` | List stored credentials (reference IDs only) |
| `openpaw vault get <id>` | Retrieve a credential by reference ID |
| `openpaw vault delete <id>` | Securely delete a credential (3-pass wipe) |
| `openpaw scan [path] [--quarantine]` | Run security scanner on skill code |
| `openpaw migrate --from openclaw` | Migrate an OpenClaw workspace to OpenPaw |
| `openpaw start` | Start the gateway + MCP proxy |
| `openpaw stop` | Stop the gateway |
| `openpaw status` | Show vault, scans, proofs, and budget status |
| `openpaw channels` | List configured channels and their connection status |
| `openpaw doctor` | Verify installation health |
| `openpaw audit show [--day]` | Show audit log entries |
| `openpaw budget set <amount>` | Set daily spending limit |
| `openpaw prove verify <hash>` | Verify a Groth16 proof against Solana |

---

## Configuration

After migration, OpenPaw creates `openpaw.json` in `~/.openpaw/`:

```jsonc
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "vault": {
    "algorithm": "aes-256-gcm",
    "keyDerivation": "scrypt"
  },
  "channels": {
    "whatsapp": {
      "accountId": "default",
      "selfChatMode": true,
      "dmPolicy": "allowlist",
      "allowFrom": ["+15551234567"],
      "flushIntervalMs": 300000
    },
    "telegram": {
      "botToken": "vault:cred_telegram_api_key_..."
    },
    "discord": {
      "botToken": "vault:cred_discord_api_key_..."
    },
    "slack": {
      "botToken": "vault:cred_slack_api_key_..."
    }
  },
  "proxy": {
    "rateLimit": {
      "maxCallsPerMinute": 60,
      "maxCallsPerHour": 500
    },
    "redaction": {
      "patterns": ["sk-*", "AIza*", "Bearer *", "ghp_*", "xoxb-*"]
    }
  },
  "scanner": {
    "autoQuarantine": false,
    "severityThreshold": "HIGH"
  },
  "audit": {
    "enabled": true,
    "logPath": ".openpaw/audit.jsonl"
  },
  "budget": {
    "dailyLimit": null,
    "currency": "USDC"
  },
  "zk": {
    "prover": "local",
    "circuits": ["IntentVerify", "PolicyCheck"]
  }
}
```

### WhatsApp Channel Configuration

WhatsApp uses the "tarball-at-rest" pattern for session security. Baileys session files are encrypted and only decrypted to RAM at runtime:

```jsonc
{
  "channels": {
    "whatsapp": {
      // Account identifier (phone number or Baileys ID)
      "accountId": "default",

      // Only respond to messages from yourself (for testing)
      "selfChatMode": true,

      // DM policy: "allowlist" (only respond to specified numbers) or "open"
      "dmPolicy": "allowlist",

      // Phone numbers allowed to message (with country code)
      "allowFrom": ["+15551234567", "+15559876543"],

      // Session flush interval (5 min default, saves encrypted session to disk)
      "flushIntervalMs": 300000
    }
  }
}
```

**Session storage:**
- Encrypted vault: `~/.openpaw/channels/whatsapp/<accountId>.vault`
- Runtime (RAM only): `/tmp/openpaw-wa-<random>/` — wiped on shutdown
- Signal handlers flush session on SIGTERM/SIGINT before exit

---

## Migration Guide

OpenPaw reads your existing OpenClaw workspace and secures it in place.

```bash
# Step 1: See what OpenPaw detects
openpaw detect ~/.openclaw

# Step 2: Run migration
openpaw migrate --from openclaw

# Step 3: Verify
openpaw doctor

# Step 4: Start
openpaw start
```

**What migration does:**

- Copies agent personality files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, TOOLS.md)
- Translates `openclaw.json` → `openpaw.json`
- Encrypts session files (`session.jsonl` → `session.jsonl.enc`)
- Extracts credentials from `auth-profiles.json` into the encrypted vault
- Migrates WhatsApp Baileys sessions to encrypted vault
- Optionally wipes the original plaintext credentials (`--wipe`)

**What migration does NOT do:**

- Change your agent's behavior or personality
- Modify your channel connections
- Require new API keys or endpoints
- Break existing skills or tools

---

## Development

```bash
# Clone
git clone https://github.com/ZkAGI/openpaw.git
cd openpaw

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (real tests, no mocks)
pnpm test

# Run a specific package
pnpm test --filter=@openpaw/vault

# Start in development mode
pnpm dev
```

### Test Philosophy

Every test operates on real files, real crypto, and real directory structures. No mocks, no simulations. Test fixtures create actual OpenClaw workspace layouts with plaintext credential files, session JSONLs, and skill code. Encryption tests use real AES-256-GCM. Scanner tests parse real ASTs.

---

## Roadmap

| Version | What Ships |
|---|---|
| **v0.1.0** | Vault, Scanner, Migration, MCP Proxy, Gateway — full local security stack |
| **v0.2.0** | Lightpanda browser (replaces Chrome), encrypted memory system |
| **v0.3.0** | Circom + Groth16 ZK attestation, Solana audit trail |
| **v0.4.0** | Oasis ROFL TEE runtime, Sapphire vault |
| **v0.5.0** | x402 payments, FROST MPC signing, budget enforcement |
| **v1.0.0** | Production release — full six-layer security stack |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

All code follows RED → GREEN → REFACTOR. Write the test first, make it pass, then clean up. PRs without tests won't be merged.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built by <a href="https://github.com/ZkAGI">ZkAGI</a><br/>
  <sub>Privacy-first AI infrastructure on Solana</sub>
</p>
