import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanSource, scanFile, scanDirectory, quarantine, restore, scanCredentials, scanCredentialsSource, CREDENTIAL_PATTERNS } from '../index.js';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

describe('Scanner - Security Rules Detection', () => {
  it('detects eval() as CRITICAL', async () => {
    const source = await readFile(join(fixturesDir, 'eval.ts'), 'utf8');
    const findings = scanSource(source, 'eval.ts');

    expect(findings.length).toBeGreaterThan(0);
    const evalFinding = findings.find(f => f.rule === 'eval');
    expect(evalFinding).toBeDefined();
    expect(evalFinding?.severity).toBe('CRITICAL');
    expect(evalFinding?.message).toContain('eval()');
  });

  it('detects Function constructor as CRITICAL', async () => {
    const source = await readFile(join(fixturesDir, 'function-constructor.ts'), 'utf8');
    const findings = scanSource(source, 'function-constructor.ts');

    expect(findings.length).toBeGreaterThan(0);
    const funcFinding = findings.find(f => f.rule === 'Function');
    expect(funcFinding).toBeDefined();
    expect(funcFinding?.severity).toBe('CRITICAL');
    expect(funcFinding?.message).toContain('Function()');
  });

  it('detects exec/execSync as CRITICAL', async () => {
    const source = await readFile(join(fixturesDir, 'exec.ts'), 'utf8');
    const findings = scanSource(source, 'exec.ts');

    expect(findings.length).toBeGreaterThan(0);
    const execFindings = findings.filter(f => f.rule === 'exec');
    expect(execFindings.length).toBeGreaterThanOrEqual(2); // exec and execSync calls
    execFindings.forEach(finding => {
      expect(finding.severity).toBe('CRITICAL');
      expect(finding.message).toContain('exec');
    });
  });

  it('detects child_process import as HIGH', async () => {
    const source = await readFile(join(fixturesDir, 'child-process.ts'), 'utf8');
    const findings = scanSource(source, 'child-process.ts');

    expect(findings.length).toBeGreaterThan(0);
    const cpFinding = findings.find(f => f.rule === 'child_process');
    expect(cpFinding).toBeDefined();
    expect(cpFinding?.severity).toBe('HIGH');
    expect(cpFinding?.message).toContain('child_process');
  });

  it('detects fetch() as HIGH', async () => {
    const source = await readFile(join(fixturesDir, 'fetch.ts'), 'utf8');
    const findings = scanSource(source, 'fetch.ts');

    expect(findings.length).toBeGreaterThan(0);
    const fetchFinding = findings.find(f => f.rule === 'fetch');
    expect(fetchFinding).toBeDefined();
    expect(fetchFinding?.severity).toBe('HIGH');
    expect(fetchFinding?.message).toContain('Network request');
  });

  it('detects dynamic require() as HIGH', async () => {
    const source = await readFile(join(fixturesDir, 'dynamic-require.ts'), 'utf8');
    const findings = scanSource(source, 'dynamic-require.ts');

    expect(findings.length).toBeGreaterThan(0);
    const requireFindings = findings.filter(f => f.rule === 'dynamic_require');
    expect(requireFindings.length).toBeGreaterThanOrEqual(2); // Two dynamic requires
    requireFindings.forEach(finding => {
      expect(finding.severity).toBe('HIGH');
      expect(finding.message).toContain('Dynamic require()');
    });
  });

  it('detects fs.writeFile to sensitive paths as HIGH', async () => {
    const source = await readFile(join(fixturesDir, 'fs-sensitive.ts'), 'utf8');
    const findings = scanSource(source, 'fs-sensitive.ts');

    expect(findings.length).toBeGreaterThan(0);
    const fsFindings = findings.filter(f => f.rule === 'fs_write_sensitive');
    expect(fsFindings.length).toBeGreaterThanOrEqual(2); // /etc/ and ~/.ssh/
    fsFindings.forEach(finding => {
      expect(finding.severity).toBe('HIGH');
      expect(finding.message).toContain('sensitive');
    });
  });

  it('detects process.env access as MEDIUM', async () => {
    const source = await readFile(join(fixturesDir, 'process-env.ts'), 'utf8');
    const findings = scanSource(source, 'process-env.ts');

    expect(findings.length).toBeGreaterThan(0);
    const envFindings = findings.filter(f => f.rule === 'process_env');
    expect(envFindings.length).toBeGreaterThanOrEqual(2); // Two process.env accesses
    envFindings.forEach(finding => {
      expect(finding.severity).toBe('MEDIUM');
      expect(finding.message).toContain('environment variable');
    });
  });

  it('detects console.log as LOW', async () => {
    const source = await readFile(join(fixturesDir, 'console-log.ts'), 'utf8');
    const findings = scanSource(source, 'console-log.ts');

    expect(findings.length).toBeGreaterThan(0);
    const logFinding = findings.find(f => f.rule === 'console_log');
    expect(logFinding).toBeDefined();
    expect(logFinding?.severity).toBe('LOW');
    expect(logFinding?.message).toContain('Console logging');
  });

  it('does not report findings for safe code', async () => {
    const source = await readFile(join(fixturesDir, 'safe.ts'), 'utf8');
    const findings = scanSource(source, 'safe.ts');

    expect(findings.length).toBe(0);
  });

  it('includes correct line and column numbers', async () => {
    const source = await readFile(join(fixturesDir, 'eval.ts'), 'utf8');
    const findings = scanSource(source, 'eval.ts');

    const evalFinding = findings.find(f => f.rule === 'eval');
    expect(evalFinding?.line).toBeGreaterThan(0);
    expect(evalFinding?.column).toBeGreaterThanOrEqual(0);
  });
});

describe('Scanner - File Operations', () => {
  it('scans a single file', async () => {
    const findings = await scanFile(join(fixturesDir, 'eval.ts'));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toContain('eval.ts');
  });

  it('scans all files in a directory', async () => {
    const result = await scanDirectory(fixturesDir);

    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.scannedAt).toBeInstanceOf(Date);
  });

  it('scans JS/TS files for code issues and config files for credentials', async () => {
    const tempDir = join(__dirname, 'temp-scan-test');
    await mkdir(tempDir, { recursive: true });

    // Create test files
    await writeFile(join(tempDir, 'test.ts'), 'eval("code")');
    await writeFile(join(tempDir, 'readme.md'), '# README'); // .md not scanned
    await writeFile(join(tempDir, 'data.json'), '{"key": "sk-test12345678901234567890"}'); // .json scanned for credentials

    const result = await scanDirectory(tempDir);

    // test.ts (code scan) + data.json (credential scan) = 2 files
    expect(result.scannedFiles).toBe(2);
    expect(result.findings.length).toBeGreaterThan(0); // eval() from test.ts
    expect(result.credentialFindings.length).toBeGreaterThan(0); // API key from data.json

    await rm(tempDir, { recursive: true });
  });
});

describe('Scanner - Credential Detection', () => {
  it('detects OpenAI API keys', () => {
    const source = '{"api_key": "sk-abcdefghijklmnopqrstuvwxyz123456"}';
    const findings = scanCredentialsSource(source, 'test.json');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('openai');
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].maskedValue).toContain('*');
    expect(findings[0].maskedValue).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('detects Google API keys', () => {
    const source = 'GOOGLE_KEY=AIzaSyB-1234567890abcdefghijklmnopqrstuvwx';
    const findings = scanCredentialsSource(source, 'test.env');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('google');
    expect(findings[0].severity).toBe('CRITICAL');
  });

  it('detects OpenRouter API keys', () => {
    const source = 'key=sk-or-v1-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const findings = scanCredentialsSource(source, 'test.yaml');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('openrouter');
    expect(findings[0].severity).toBe('CRITICAL');
  });

  it('detects GitHub tokens', () => {
    const source = 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const findings = scanCredentialsSource(source, 'test.env');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('github');
    expect(findings[0].severity).toBe('CRITICAL');
  });

  it('detects Slack bot tokens', () => {
    // Build token dynamically to avoid GitHub secret scanner false positive
    const prefix = 'xoxb';
    const source = `slack: ${prefix}-111111111-222222222-testtoken00001`;
    const findings = scanCredentialsSource(source, 'test.yaml');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('slack');
    expect(findings[0].severity).toBe('CRITICAL');
  });

  it('detects AWS access keys', () => {
    const source = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
    const findings = scanCredentialsSource(source, 'test.env');

    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('aws');
    expect(findings[0].severity).toBe('CRITICAL');
  });

  it('scans fixture JSON file with multiple credentials', async () => {
    const findings = await scanCredentials(join(fixturesDir, 'credentials.json'));

    // Should detect: openai, google, openrouter, github, aws (slack tested inline to avoid GitHub scanner)
    expect(findings.length).toBe(5);

    const types = findings.map(f => f.type).sort();
    expect(types).toContain('openai');
    expect(types).toContain('google');
    expect(types).toContain('openrouter');
    expect(types).toContain('github');
    expect(types).toContain('aws');

    // All should have masked values
    for (const finding of findings) {
      expect(finding.maskedValue).toContain('*');
      expect(finding.line).toBeGreaterThan(0);
    }
  });

  it('scans fixture .env file with credentials', async () => {
    const findings = await scanCredentials(join(fixturesDir, 'credentials.env'));

    // Should detect: openai, google, github, aws
    expect(findings.length).toBe(4);

    const types = findings.map(f => f.type).sort();
    expect(types).toContain('openai');
    expect(types).toContain('google');
    expect(types).toContain('github');
    expect(types).toContain('aws');
  });

  it('includes correct line numbers for multi-line files', async () => {
    const findings = await scanCredentials(join(fixturesDir, 'credentials.json'));

    // Verify line numbers are sequential (each key on different line)
    const lines = findings.map(f => f.line).sort((a, b) => a - b);
    expect(lines[0]).toBeGreaterThan(0);

    // Each finding should be on a different line
    const uniqueLines = new Set(lines);
    expect(uniqueLines.size).toBe(findings.length);
  });

  it('masks values correctly', () => {
    // Test OpenAI masking
    const openaiFindings = scanCredentialsSource('{"key": "sk-abc123xyz456def789ghi012jkl345mno678"}', 'test.json');
    expect(openaiFindings[0].maskedValue.startsWith('sk-abc1')).toBe(true);
    expect(openaiFindings[0].maskedValue.endsWith('o678')).toBe(true);
    expect(openaiFindings[0].maskedValue).toContain('*');
  });

  it('does not report false positives for short strings', () => {
    const source = '{"key": "sk-short"}'; // Too short to be a real OpenAI key
    const findings = scanCredentialsSource(source, 'test.json');

    expect(findings.length).toBe(0);
  });
});

describe('Scanner - Quarantine System', () => {
  const testFile = join(__dirname, 'temp-quarantine-test.ts');
  const quarantineDir = join(__dirname, '.quarantine');

  beforeEach(async () => {
    await writeFile(testFile, 'eval("test")');
  });

  afterEach(async () => {
    try {
      await rm(testFile, { force: true });
    } catch { /* Ignore cleanup errors */ }
    try {
      await rm(quarantineDir, { recursive: true, force: true });
    } catch { /* Ignore cleanup errors */ }
  });

  it('quarantines a file and creates lock', async () => {
    const quarantinedPath = await quarantine(testFile, quarantineDir);

    // Verify file was moved
    expect(quarantinedPath).toContain(quarantineDir);

    // Verify lock file exists
    const lockContent = await readFile(`${quarantinedPath}.lock`, 'utf8');
    const lockData = JSON.parse(lockContent);
    expect(lockData.originalPath).toBe(testFile);
    expect(lockData.quarantinedPath).toBe(quarantinedPath);

    // Verify file permissions are locked (0o000)
    try {
      await readFile(quarantinedPath, 'utf8');
      // If we can read it, the test should fail
      expect.fail('Should not be able to read locked file');
    } catch (error: any) {
      expect(error.code).toBe('EACCES');
    }
  });

  it('restores a quarantined file', async () => {
    const quarantinedPath = await quarantine(testFile, quarantineDir);
    await restore(quarantinedPath, testFile);

    // Verify file was restored
    const content = await readFile(testFile, 'utf8');
    expect(content).toBe('eval("test")');

    // Verify lock file was removed
    try {
      await readFile(`${quarantinedPath}.lock`, 'utf8');
      expect.fail('Lock file should have been removed');
    } catch (error: any) {
      expect(error.code).toBe('ENOENT');
    }
  });

  it('handles multiple quarantined files', async () => {
    const testFile2 = join(__dirname, 'temp-quarantine-test2.ts');
    await writeFile(testFile2, 'fetch("url")');

    const q1 = await quarantine(testFile, quarantineDir);
    const q2 = await quarantine(testFile2, quarantineDir);

    expect(q1).not.toBe(q2);
    expect(q1).toContain(quarantineDir);
    expect(q2).toContain(quarantineDir);

    await restore(q1, testFile);
    await restore(q2, testFile2);

    const content1 = await readFile(testFile, 'utf8');
    const content2 = await readFile(testFile2, 'utf8');
    expect(content1).toBe('eval("test")');
    expect(content2).toBe('fetch("url")');

    await rm(testFile2, { force: true });
  });
});

describe('Scanner - All Patterns Detected', () => {
  it('verifies ALL security patterns are detected in fixtures', async () => {
    const result = await scanDirectory(fixturesDir);

    // Expected rules to be found
    const expectedRules = [
      'eval',
      'Function',
      'exec',
      'child_process',
      'fetch',
      'dynamic_require',
      'fs_write_sensitive',
      'process_env',
      'console_log',
    ];

    const detectedRules = new Set(result.findings.map(f => f.rule));

    for (const rule of expectedRules) {
      expect(detectedRules.has(rule), `Rule '${rule}' should be detected`).toBe(true);
    }
  });

  it('verifies correct severity levels for all findings', async () => {
    const result = await scanDirectory(fixturesDir);

    const criticalRules = ['eval', 'Function', 'exec'];
    const highRules = ['child_process', 'fetch', 'dynamic_require', 'fs_write_sensitive'];
    const mediumRules = ['process_env'];
    const lowRules = ['console_log'];

    for (const finding of result.findings) {
      if (criticalRules.includes(finding.rule)) {
        expect(finding.severity).toBe('CRITICAL');
      } else if (highRules.includes(finding.rule)) {
        expect(finding.severity).toBe('HIGH');
      } else if (mediumRules.includes(finding.rule)) {
        expect(finding.severity).toBe('MEDIUM');
      } else if (lowRules.includes(finding.rule)) {
        expect(finding.severity).toBe('LOW');
      }
    }
  });
});
