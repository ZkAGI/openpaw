#!/usr/bin/env node
import { Command } from 'commander';
import { createVault, generateMasterKey, deriveKeyFromPassword } from '@openpaw/vault';
import { detectAgents, formatDetectResultAsJson } from '@openpaw/detect';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const program = new Command();

// Config directory and files
const CONFIG_DIR = join(homedir(), '.openpaw');
const KEY_FILE = join(CONFIG_DIR, 'master.key');
const VAULT_FILE = join(CONFIG_DIR, 'vault.json');

// Helper to read a line from stdin
async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Helper to get or create master key
async function getMasterKey(): Promise<Buffer> {
  try {
    const keyData = await readFile(KEY_FILE);
    return keyData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Generate new key
      const key = generateMasterKey();
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(KEY_FILE, key, { mode: 0o600 });
      console.log(`Created new master key at ${KEY_FILE}`);
      return key;
    }
    throw error;
  }
}

program
  .name('openpaw')
  .description('Security-first wrapper for AI agents')
  .version('1.0.0');

// Vault command group
const vaultCmd = program
  .command('vault')
  .description('Manage encrypted credentials');

vaultCmd
  .command('import')
  .description('Import a credential')
  .requiredOption('--service <service>', 'Service name (e.g., openai, github)')
  .requiredOption('--type <type>', 'Credential type (api_key, oauth_token, password, certificate)')
  .option('--value <value>', 'Credential value (will prompt if not provided)')
  .action(async (options: { service: string; type: string; value?: string }) => {
    try {
      const validTypes = ['api_key', 'oauth_token', 'password', 'certificate'] as const;
      if (!validTypes.includes(options.type as typeof validTypes[number])) {
        console.error(`Error: Invalid type "${options.type}". Must be one of: ${validTypes.join(', ')}`);
        process.exit(1);
      }

      let value = options.value;
      if (!value) {
        // Read from stdin if not provided
        value = await readLine('Enter credential value: ');
      }

      const key = await getMasterKey();
      const vault = await createVault(key, VAULT_FILE);
      const credential = await vault.import(
        options.service,
        options.type as typeof validTypes[number],
        value
      );

      console.log(JSON.stringify({
        success: true,
        id: credential.id,
        service: credential.service,
        type: credential.type,
        createdAt: credential.createdAt,
      }, null, 2));
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

vaultCmd
  .command('list')
  .description('List stored credentials')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const key = await getMasterKey();
      const vault = await createVault(key, VAULT_FILE);
      const credentials = vault.list();

      if (options.json) {
        console.log(JSON.stringify({ credentials }, null, 2));
      } else {
        if (credentials.length === 0) {
          console.log('No credentials stored.');
        } else {
          console.log('Stored credentials:');
          for (const cred of credentials) {
            console.log(`  ${cred.id}`);
            console.log(`    Service: ${cred.service}`);
            console.log(`    Type: ${cred.type}`);
            console.log(`    Created: ${cred.createdAt}`);
            console.log();
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

vaultCmd
  .command('get')
  .description('Get a credential by ID')
  .argument('<id>', 'Credential ID')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options: { json?: boolean }) => {
    try {
      const key = await getMasterKey();
      const vault = await createVault(key, VAULT_FILE);
      const result = vault.get(id);

      if (!result) {
        console.error(`Error: Credential not found: ${id}`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify({
          id: result.credential.id,
          service: result.credential.service,
          type: result.credential.type,
          value: result.value,
          createdAt: result.credential.createdAt,
          updatedAt: result.credential.updatedAt,
        }, null, 2));
      } else {
        console.log(`ID: ${result.credential.id}`);
        console.log(`Service: ${result.credential.service}`);
        console.log(`Type: ${result.credential.type}`);
        console.log(`Value: ${result.value}`);
        console.log(`Created: ${result.credential.createdAt}`);
        console.log(`Updated: ${result.credential.updatedAt}`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

vaultCmd
  .command('delete')
  .description('Delete a credential by ID')
  .argument('<id>', 'Credential ID')
  .action(async (id: string) => {
    try {
      const key = await getMasterKey();
      const vault = await createVault(key, VAULT_FILE);
      const deleted = await vault.delete(id);

      if (!deleted) {
        console.error(`Error: Credential not found: ${id}`);
        process.exit(1);
      }

      console.log(`Deleted credential: ${id}`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Detect command
program
  .command('detect')
  .description('Detect installed AI agents in a directory')
  .argument('[path]', 'Directory to scan', '.')
  .option('--json', 'Output as JSON')
  .action(async (path: string, options: { json?: boolean }) => {
    try {
      const result = await detectAgents(path);

      if (options.json) {
        console.log(formatDetectResultAsJson(result));
      } else {
        if (result.agents.length === 0) {
          console.log(`No AI agents detected in ${path}`);
        } else {
          console.log(`Detected ${result.agents.length} AI agent(s) in ${path}:`);
          for (const agent of result.agents) {
            console.log(`\n  ${agent.name} (${agent.type})`);
            console.log(`    Path: ${agent.path}`);
            console.log(`    Config files: ${agent.configFiles.join(', ')}`);
            if (agent.version) {
              console.log(`    Version: ${agent.version}`);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Scan command (placeholder - delegates to scanner package)
program
  .command('scan')
  .description('Scan directory for security issues')
  .argument('[path]', 'Directory to scan', '.')
  .action(async (path: string) => {
    console.log(`Scanning ${path} for security issues...`);
    console.log('(Scanner package not yet implemented)');
  });

// Migrate command (placeholder - delegates to migrate package)
program
  .command('migrate')
  .description('Migrate from another agent framework')
  .option('--from <framework>', 'Source framework (e.g., openclaw)')
  .action(async (options: { from?: string }) => {
    console.log(`Migration from ${options.from ?? 'unknown'} framework...`);
    console.log('(Migrate package not yet implemented)');
  });

// Start command (placeholder)
program
  .command('start')
  .description('Start OpenPaw services')
  .action(async () => {
    console.log('Starting OpenPaw services...');
    console.log('(Gateway and MCP proxy not yet implemented)');
  });

// Stop command (placeholder)
program
  .command('stop')
  .description('Stop OpenPaw services')
  .action(async () => {
    console.log('Stopping OpenPaw services...');
    console.log('(Gateway and MCP proxy not yet implemented)');
  });

// Status command
program
  .command('status')
  .description('Show running services and vault stats')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    try {
      const key = await getMasterKey();
      const vault = await createVault(key, VAULT_FILE);
      const credentials = vault.list();

      const status = {
        vault: {
          path: VAULT_FILE,
          credentialCount: credentials.length,
        },
        services: {
          gateway: 'not running',
          mcpProxy: 'not running',
        },
      };

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log('OpenPaw Status');
        console.log('==============');
        console.log(`\nVault: ${VAULT_FILE}`);
        console.log(`  Credentials: ${credentials.length}`);
        console.log('\nServices:');
        console.log('  Gateway: not running');
        console.log('  MCP Proxy: not running');
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Doctor command
program
  .command('doctor')
  .description('Check dependencies and configuration')
  .option('--json', 'Output as JSON')
  .action(async (options: { json?: boolean }) => {
    const checks: Array<{ name: string; status: 'PASS' | 'FAIL' | 'WARN'; message: string }> = [];

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] ?? '0', 10);
    if (majorVersion >= 18) {
      checks.push({ name: 'Node.js', status: 'PASS', message: `${nodeVersion} (>= 18 required)` });
    } else {
      checks.push({ name: 'Node.js', status: 'FAIL', message: `${nodeVersion} (>= 18 required)` });
    }

    // Check config directory
    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      checks.push({ name: 'Config directory', status: 'PASS', message: CONFIG_DIR });
    } catch (error) {
      checks.push({ name: 'Config directory', status: 'FAIL', message: (error as Error).message });
    }

    // Check master key
    try {
      const keyStats = await readFile(KEY_FILE);
      if (keyStats.length === 32) {
        checks.push({ name: 'Master key', status: 'PASS', message: 'Valid 256-bit key' });
      } else {
        checks.push({ name: 'Master key', status: 'WARN', message: 'Key exists but has unexpected length' });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        checks.push({ name: 'Master key', status: 'WARN', message: 'Not created yet (will be created on first use)' });
      } else {
        checks.push({ name: 'Master key', status: 'FAIL', message: (error as Error).message });
      }
    }

    // Check vault file
    try {
      await readFile(VAULT_FILE);
      checks.push({ name: 'Vault file', status: 'PASS', message: VAULT_FILE });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        checks.push({ name: 'Vault file', status: 'WARN', message: 'Not created yet (will be created on first import)' });
      } else {
        checks.push({ name: 'Vault file', status: 'FAIL', message: (error as Error).message });
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ checks }, null, 2));
    } else {
      console.log('OpenPaw Doctor');
      console.log('==============\n');
      for (const check of checks) {
        const icon = check.status === 'PASS' ? '[PASS]' : check.status === 'WARN' ? '[WARN]' : '[FAIL]';
        console.log(`${icon} ${check.name}: ${check.message}`);
      }

      const hasFailures = checks.some((c) => c.status === 'FAIL');
      console.log();
      if (hasFailures) {
        console.log('Some checks failed. Please fix the issues above.');
        process.exit(1);
      } else {
        console.log('All checks passed!');
      }
    }
  });

program.parse();
