import { describe, it, expect } from 'vitest';
import { scanDirectory } from '../index.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Scanner - Benchmark', () => {
  it('scans 10 files in less than 500ms', async () => {
    const tempDir = join(__dirname, 'temp-benchmark');
    await mkdir(tempDir, { recursive: true });

    // Create 10 test files with various patterns
    const testFiles = [
      { name: 'file1.ts', content: 'export function test() { eval("code"); }' },
      { name: 'file2.ts', content: 'import { exec } from "child_process"; exec("ls");' },
      { name: 'file3.ts', content: 'export function test() { fetch("http://api.com"); }' },
      { name: 'file4.ts', content: 'export const key = process.env.API_KEY;' },
      { name: 'file5.ts', content: 'export function log() { console.log("test"); }' },
      { name: 'file6.ts', content: 'export function loadMod(name: string) { return require(name); }' },
      { name: 'file7.ts', content: 'import * as fs from "fs"; fs.writeFileSync("/etc/passwd", "data");' },
      { name: 'file8.ts', content: 'export function createFn() { return new Function("a", "return a"); }' },
      { name: 'file9.ts', content: 'export function safe(a: number, b: number) { return a + b; }' },
      { name: 'file10.ts', content: 'export class Calculator { add(x: number, y: number) { return x + y; } }' },
    ];

    for (const file of testFiles) {
      await writeFile(join(tempDir, file.name), file.content);
    }

    const startTime = performance.now();
    const result = await scanDirectory(tempDir);
    const endTime = performance.now();
    const duration = endTime - startTime;

    // Verify scan completed
    expect(result.scannedFiles).toBe(10);
    expect(result.findings.length).toBeGreaterThan(0);

    // Benchmark: scan should complete in < 500ms
    expect(duration).toBeLessThan(500);

    console.log(`✓ Scanned ${result.scannedFiles} files in ${duration.toFixed(2)}ms (< 500ms)`);
    console.log(`✓ Found ${result.findings.length} security findings`);

    await rm(tempDir, { recursive: true });
  });

  it('maintains performance with nested directories', async () => {
    const tempDir = join(__dirname, 'temp-benchmark-nested');
    await mkdir(join(tempDir, 'src', 'utils'), { recursive: true });
    await mkdir(join(tempDir, 'src', 'services'), { recursive: true });
    await mkdir(join(tempDir, 'tests'), { recursive: true });

    // Create files in nested structure
    const files = [
      'src/index.ts',
      'src/utils/helper.ts',
      'src/utils/formatter.ts',
      'src/services/api.ts',
      'src/services/auth.ts',
      'tests/unit.test.ts',
      'tests/integration.test.ts',
    ];

    for (const file of files) {
      await writeFile(
        join(tempDir, file),
        'export function test() { eval("test"); fetch("url"); console.log("x"); }'
      );
    }

    const startTime = performance.now();
    const result = await scanDirectory(tempDir);
    const endTime = performance.now();
    const duration = endTime - startTime;

    expect(result.scannedFiles).toBe(7);
    expect(duration).toBeLessThan(500);

    console.log(`✓ Scanned ${result.scannedFiles} nested files in ${duration.toFixed(2)}ms (< 500ms)`);

    await rm(tempDir, { recursive: true });
  });
});
