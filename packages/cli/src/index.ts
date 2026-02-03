#!/usr/bin/env node
import { Command } from 'commander';
import { createVault, generateMasterKey, encrypt } from '@zkagi/openpaw-vault';
import { detectAgents, formatDetectResultAsJson } from '@zkagi/openpaw-detect';
import { scanDirectory, type Severity, type CredentialFinding } from '@zkagi/openpaw-scanner';
import { copyWorkspaceFiles, encryptSession, translateConfig, migrateCredentials, type MigrationSource, MigrationSourceSchema } from '@zkagi/openpaw-migrate';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
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

// Scan command - uses scanner package
program
  .command('scan')
  .description('Scan directory for security issues')
  .argument('[path]', 'Directory to scan', '.')
  .option('--json', 'Output as JSON')
  .action(async (path: string, options: { json?: boolean }) => {
    try {
      console.log(`Scanning ${path} for security issues...`);
      const result = await scanDirectory(path);

      const totalIssues = result.findings.length + result.credentialFindings.length;

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\nScanned ${result.scannedFiles} files at ${result.scannedAt.toISOString()}`);
        console.log(`Found ${totalIssues} issue(s) (${result.findings.length} code, ${result.credentialFindings.length} credential)\n`);

        // Show credential findings first (always CRITICAL)
        if (result.credentialFindings.length > 0) {
          console.log(`[CREDENTIAL] (${result.credentialFindings.length} exposed key(s))`);
          for (const finding of result.credentialFindings) {
            console.log(`  ${finding.file}:${finding.line}:${finding.column}`);
            console.log(`    Type: ${finding.type}`);
            console.log(`    Value: ${finding.maskedValue}`);
            console.log(`    ${finding.message}`);
          }
          console.log();
        }

        if (result.findings.length > 0) {
          // Group by severity
          const bySeverity: Record<Severity, typeof result.findings> = {
            CRITICAL: [],
            HIGH: [],
            MEDIUM: [],
            LOW: [],
          };

          for (const finding of result.findings) {
            bySeverity[finding.severity].push(finding);
          }

          for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const) {
            const findings = bySeverity[severity];
            if (findings.length > 0) {
              console.log(`[${severity}] (${findings.length} issue(s))`);
              for (const finding of findings) {
                console.log(`  ${finding.file}:${finding.line}:${finding.column}`);
                console.log(`    Rule: ${finding.rule}`);
                console.log(`    ${finding.message}`);
              }
              console.log();
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Migrate command - uses migrate package
program
  .command('migrate')
  .description('Migrate from another agent framework')
  .requiredOption('--from <framework>', 'Source framework (openclaw, cline, cursor, windsurf)')
  .option('--source <path>', 'Source directory', '.')
  .option('--dest <path>', 'Destination directory', join(homedir(), '.openpaw', 'migrated'))
  .option('--openclaw-dir <path>', 'OpenClaw config directory', join(homedir(), '.openclaw'))
  .option('--json', 'Output as JSON')
  .action(async (options: { from: string; source: string; dest: string; openclawDir: string; json?: boolean }) => {
    try {
      // Validate source framework
      const parseResult = MigrationSourceSchema.safeParse(options.from);
      if (!parseResult.success) {
        console.error(`Error: Invalid framework "${options.from}". Must be one of: openclaw, cline, cursor, windsurf`);
        process.exit(1);
      }
      const framework = parseResult.data;

      console.log(`Migrating from ${framework}...`);

      // Step 1: Copy workspace files
      console.log(`\n1. Copying workspace files from ${options.source}...`);
      const copiedFiles = await copyWorkspaceFiles(options.source, options.dest);
      console.log(`   Copied ${copiedFiles.length} file(s)`);

      // Step 2: Encrypt session files
      console.log('\n2. Encrypting session files...');
      const key = await getMasterKey();
      const sessionDir = join(options.source, 'sessions');
      try {
        const sessionFiles = await readdir(sessionDir);
        const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));
        for (const file of jsonlFiles) {
          const sourcePath = join(sessionDir, file);
          const destPath = join(options.dest, 'sessions', `${file}.enc`);
          await mkdir(join(options.dest, 'sessions'), { recursive: true });
          const content = await readFile(sourcePath, 'utf8');
          const encrypted = encrypt(content, key);
          await writeFile(destPath, encrypted);
          console.log(`   Encrypted: ${file}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        console.log('   No session files found');
      }

      // Step 3: Translate config
      console.log('\n3. Translating configuration...');
      const configPath = join(options.source, `${framework}.json`);
      const destConfigPath = join(options.dest, 'openpaw.json');
      try {
        await translateConfig(configPath, destConfigPath, framework);
        console.log(`   Wrote: openpaw.json`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        console.log('   No config file found');
      }

      // Step 4: Migrate credentials from OpenClaw auth-profiles.json (for openclaw framework)
      let credentialsMigrated = 0;
      if (framework === 'openclaw') {
        console.log('\n4. Migrating credentials from OpenClaw auth-profiles.json...');
        const vault = await createVault(key, VAULT_FILE);
        const credResult = await migrateCredentials(options.openclawDir, vault);

        if (credResult.credentialsImported > 0) {
          console.log(`   Imported ${credResult.credentialsImported} credential(s) to vault`);
          console.log(`   Backed up ${credResult.filesBackedUp.length} file(s)`);
          credentialsMigrated = credResult.credentialsImported;
        } else if (credResult.profilesProcessed === 0) {
          console.log('   No auth-profiles.json files found');
        } else {
          console.log('   All credentials already migrated');
        }

        if (credResult.errors.length > 0) {
          for (const error of credResult.errors) {
            console.log(`   Warning: ${error}`);
          }
        }
      }

      const result = {
        success: true,
        framework,
        source: options.source,
        destination: options.dest,
        copiedFiles: copiedFiles.length,
        credentialsMigrated,
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('\nMigration complete!');
        console.log(`Destination: ${options.dest}`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
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
