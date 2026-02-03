#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('openpaw')
  .description('Security-first wrapper for AI agents')
  .version('1.0.0');

program
  .command('vault')
  .description('Manage encrypted credentials')
  .addCommand(
    new Command('import').description('Import a credential').action(() => {
      console.error('vault import: not yet implemented');
    })
  )
  .addCommand(
    new Command('list').description('List stored credentials').action(() => {
      console.error('vault list: not yet implemented');
    })
  )
  .addCommand(
    new Command('get').description('Get a credential by ID').action(() => {
      console.error('vault get: not yet implemented');
    })
  );

program
  .command('scan')
  .description('Scan directory for security issues')
  .argument('[path]', 'Directory to scan', '.')
  .action((path: string) => {
    console.error(`scan ${path}: not yet implemented`);
  });

program
  .command('migrate')
  .description('Migrate from another agent framework')
  .option('--from <framework>', 'Source framework (e.g., openclaw)')
  .action((options: { from?: string }) => {
    console.error(`migrate --from ${options.from ?? 'unknown'}: not yet implemented`);
  });

program
  .command('status')
  .description('Show running services and vault stats')
  .action(() => {
    console.error('status: not yet implemented');
  });

program
  .command('doctor')
  .description('Check dependencies and configuration')
  .action(() => {
    console.error('doctor: not yet implemented');
  });

program.parse();
