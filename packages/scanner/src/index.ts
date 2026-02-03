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
        if (node.arguments.length > 0) {
          const arg = node.arguments[0];
          return arg.type !== 'Literal' || typeof arg.value !== 'string';
        }
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
          if (node.arguments.length > 0) {
            const pathArg = node.arguments[0];
            if (pathArg.type === 'Literal' && typeof pathArg.value === 'string') {
              const sensitivePaths = ['/etc/', '~/.ssh/', '/root/', '~/.aws/', '/System/', '/Windows/'];
              return sensitivePaths.some(path => pathArg.value!.toString().includes(path));
            }
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

export async function scanDirectory(dirPath: string): Promise<ScanResult> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const findings: Finding[] = [];
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
        // Only scan TypeScript and JavaScript files
        if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
          const fileFindings = await scanFile(fullPath);
          findings.push(...fileFindings);
          scannedFiles++;
        }
      }
    }
  }

  await scanRecursive(dirPath);

  return {
    findings,
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
