import { parse } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { z } from 'zod';

export const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingSchema = z.object({
  rule: z.string(),
  severity: SeveritySchema,
  message: z.string(),
  file: z.string(),
  line: z.number(),
  column: z.number(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const CredentialFindingSchema = z.object({
  rule: z.literal('credential'),
  severity: SeveritySchema,
  message: z.string(),
  file: z.string(),
  line: z.number(),
  column: z.number(),
  type: z.string(),
  maskedValue: z.string(),
});

export type CredentialFinding = z.infer<typeof CredentialFindingSchema>;

// Credential patterns for common API keys
export const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp; mask: (value: string) => string }> = [
  {
    name: 'openai',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    mask: (v) => v.slice(0, 7) + '*'.repeat(Math.max(0, v.length - 11)) + v.slice(-4),
  },
  {
    name: 'google',
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    mask: (v) => v.slice(0, 8) + '*'.repeat(Math.max(0, v.length - 12)) + v.slice(-4),
  },
  {
    name: 'openrouter',
    pattern: /sk-or-v1-[a-f0-9]{64}/g,
    mask: (v) => v.slice(0, 12) + '*'.repeat(Math.max(0, v.length - 16)) + v.slice(-4),
  },
  {
    name: 'github',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    mask: (v) => v.slice(0, 7) + '*'.repeat(Math.max(0, v.length - 11)) + v.slice(-4),
  },
  {
    name: 'slack',
    pattern: /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g,
    mask: (v) => v.slice(0, 9) + '*'.repeat(Math.max(0, v.length - 13)) + v.slice(-4),
  },
  {
    name: 'aws',
    pattern: /AKIA[A-Z0-9]{16}/g,
    mask: (v) => v.slice(0, 8) + '*'.repeat(Math.max(0, v.length - 12)) + v.slice(-4),
  },
];

export interface ScanResult {
  findings: Finding[];
  scannedFiles: number;
  scannedAt: Date;
}

interface SecurityRule {
  name: string;
  severity: Severity;
  message: string;
  check: (node: TSESTree.Node, sourceCode: string) => boolean;
}

const SECURITY_RULES: SecurityRule[] = [
  // eval() call - CRITICAL
  {
    name: 'eval',
    severity: 'CRITICAL',
    message: 'eval() can execute arbitrary code',
    check: (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'eval',
  },
  // Function constructor - CRITICAL
  {
    name: 'Function',
    severity: 'CRITICAL',
    message: 'Function() constructor can execute arbitrary code',
    check: (node) =>
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Function',
  },
  // exec/execSync imports - CRITICAL
  {
    name: 'exec',
    severity: 'CRITICAL',
    message: 'exec can execute arbitrary system commands',
    check: (node, sourceCode) => {
      if (node.type === 'ImportSpecifier' && node.imported.type === 'Identifier') {
        const importName = node.imported.name;
        return importName === 'exec' || importName === 'execSync' || importName === 'spawn';
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        return node.callee.name === 'exec' || node.callee.name === 'execSync';
      }
      return false;
    },
  },
  // child_process import - HIGH
  {
    name: 'child_process',
    severity: 'HIGH',
    message: 'child_process can execute system commands',
    check: (node) =>
      node.type === 'ImportDeclaration' &&
      node.source.type === 'Literal' &&
      (node.source.value === 'child_process' || node.source.value === 'node:child_process'),
  },
  // fetch() call - HIGH
  {
    name: 'fetch',
    severity: 'HIGH',
    message: 'Network request detected',
    check: (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'fetch',
  },
  // dynamic require() - HIGH
  {
    name: 'dynamic_require',
    severity: 'HIGH',
    message: 'Dynamic require() can load arbitrary modules',
    check: (node) => {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
        // Check if argument is not a string literal (dynamic)
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal' && 'value' in arg) {
          return typeof arg.value !== 'string';
        }
        return node.arguments.length > 0;
      }
      return false;
    },
  },
  // fs.writeFile to sensitive paths - HIGH
  {
    name: 'fs_write_sensitive',
    severity: 'HIGH',
    message: 'Writing to sensitive file paths',
    check: (node) => {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const obj = node.callee.object;
        const prop = node.callee.property;

        if (obj.type === 'Identifier' && obj.name === 'fs' &&
            prop.type === 'Identifier' && (prop.name === 'writeFile' || prop.name === 'writeFileSync')) {
          // Check if path argument contains sensitive paths
          const pathArg = node.arguments[0];
          if (pathArg && pathArg.type === 'Literal' && 'value' in pathArg && typeof pathArg.value === 'string') {
            const sensitivePaths = ['/etc/', '~/.ssh/', '/root/', '~/.aws/', '/System/', '/Windows/'];
            return sensitivePaths.some(path => pathArg.value.includes(path));
          }
        }
      }
      return false;
    },
  },
  // process.env access - MEDIUM
  {
    name: 'process_env',
    severity: 'MEDIUM',
    message: 'Direct environment variable access',
    check: (node) =>
      node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      node.object.name === 'process' &&
      node.property.type === 'Identifier' &&
      node.property.name === 'env',
  },
  // console.log - LOW
  {
    name: 'console_log',
    severity: 'LOW',
    message: 'Console logging detected (may leak sensitive data)',
    check: (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === 'console' &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'log',
  },
];

export function parseAST(source: string, fileName: string): TSESTree.Program {
  return parse(source, {
    loc: true,
    range: true,
    comment: false,
    jsx: fileName.endsWith('.tsx') || fileName.endsWith('.jsx'),
  });
}

export function scanSource(source: string, fileName: string): Finding[] {
  const findings: Finding[] = [];
  const ast = parseAST(source, fileName);

  function visit(node: TSESTree.Node) {
    for (const rule of SECURITY_RULES) {
      if (rule.check(node, source)) {
        findings.push({
          rule: rule.name,
          severity: rule.severity,
          message: rule.message,
          file: fileName,
          line: node.loc?.start.line ?? 0,
          column: node.loc?.start.column ?? 0,
        });
      }
    }

    // Recursively visit child nodes
    for (const key in node) {
      const child = (node as any)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach((item) => {
            if (item && typeof item === 'object' && 'type' in item) {
              visit(item);
            }
          });
        } else if ('type' in child) {
          visit(child);
        }
      }
    }
  }

  visit(ast);
  return findings;
}

export async function scanFile(filePath: string): Promise<Finding[]> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(filePath, 'utf8');
  return scanSource(source, filePath);
}

export function scanCredentialsSource(source: string, fileName: string): CredentialFinding[] {
  const findings: CredentialFinding[] = [];
  const lines = source.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;

    for (const { name, pattern, mask } of CREDENTIAL_PATTERNS) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(line)) !== null) {
        findings.push({
          rule: 'credential',
          severity: 'CRITICAL',
          message: `Exposed ${name} API key detected`,
          file: fileName,
          line: lineIndex + 1,
          column: match.index,
          type: name,
          maskedValue: mask(match[0]),
        });
      }
    }
  }

  return findings;
}

export async function scanCredentials(filePath: string): Promise<CredentialFinding[]> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(filePath, 'utf8');
  return scanCredentialsSource(source, filePath);
}

export interface ScanResultExtended extends ScanResult {
  credentialFindings: CredentialFinding[];
}

export async function scanDirectory(dirPath: string): Promise<ScanResultExtended> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const findings: Finding[] = [];
  const credentialFindings: CredentialFinding[] = [];
  let scannedFiles = 0;

  async function scanRecursive(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath);

    for (const entry of entries) {
      const fullPath = join(currentPath, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Skip node_modules and common build directories
        if (!['node_modules', 'dist', 'build', '.git', '.turbo'].includes(entry)) {
          await scanRecursive(fullPath);
        }
      } else if (stats.isFile()) {
        // Scan TypeScript and JavaScript files for AST-based rules
        if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
          const fileFindings = await scanFile(fullPath);
          findings.push(...fileFindings);
          // Also scan code files for credentials
          const credFindings = await scanCredentials(fullPath);
          credentialFindings.push(...credFindings);
          scannedFiles++;
        }
        // Scan config and data files for credentials
        else if (/\.(json|env|yaml|yml|txt)$/.test(entry) || entry === '.env') {
          const credFindings = await scanCredentials(fullPath);
          credentialFindings.push(...credFindings);
          scannedFiles++;
        }
      }
    }
  }

  await scanRecursive(dirPath);

  return {
    findings,
    credentialFindings,
    scannedFiles,
    scannedAt: new Date(),
  };
}

export async function quarantine(filePath: string, quarantineDir: string): Promise<string> {
  const { rename, chmod, mkdir, writeFile } = await import('node:fs/promises');
  const { basename, join } = await import('node:path');

  await mkdir(quarantineDir, { recursive: true });

  const timestamp = Date.now();
  const destPath = join(quarantineDir, `${timestamp}_${basename(filePath)}`);
  const lockPath = join(quarantineDir, `${timestamp}_${basename(filePath)}.lock`);

  // Move file to quarantine
  await rename(filePath, destPath);

  // Lock the file
  await chmod(destPath, 0o000);

  // Create lock file with metadata
  await writeFile(lockPath, JSON.stringify({
    originalPath: filePath,
    quarantinedAt: new Date().toISOString(),
    quarantinedPath: destPath,
  }));

  return destPath;
}

export async function restore(quarantinedPath: string, originalPath: string): Promise<void> {
  const { rename, chmod, unlink } = await import('node:fs/promises');
  const { dirname } = await import('node:path');

  // Unlock the file
  await chmod(quarantinedPath, 0o644);

  // Move back to original location
  await rename(quarantinedPath, originalPath);

  // Remove lock file if it exists
  const lockPath = `${quarantinedPath}.lock`;
  try {
    await unlink(lockPath);
  } catch {
    // Lock file might not exist, ignore
  }
}
