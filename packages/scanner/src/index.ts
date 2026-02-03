import * as ts from 'typescript';
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

const SECURITY_RULES: Array<{ pattern: string; severity: Severity; message: string }> = [
  { pattern: 'eval', severity: 'CRITICAL', message: 'eval() can execute arbitrary code' },
  { pattern: 'Function', severity: 'CRITICAL', message: 'Function() constructor can execute arbitrary code' },
  { pattern: 'child_process', severity: 'HIGH', message: 'child_process can execute system commands' },
  { pattern: 'process.env', severity: 'MEDIUM', message: 'Direct environment variable access' },
  { pattern: 'fetch', severity: 'HIGH', message: 'Network request detected' },
];

export function parseAST(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
}

export function scanSource(source: string, fileName: string): Finding[] {
  const findings: Finding[] = [];
  const sourceFile = parseAST(source, fileName);

  function visit(node: ts.Node) {
    const text = node.getText(sourceFile);
    for (const rule of SECURITY_RULES) {
      if (text.includes(rule.pattern)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        findings.push({
          rule: rule.pattern,
          severity: rule.severity,
          message: rule.message,
          file: fileName,
          line: line + 1,
          column: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export async function quarantine(filePath: string, quarantineDir: string): Promise<string> {
  const { rename, chmod, mkdir } = await import('node:fs/promises');
  const { basename, join } = await import('node:path');
  await mkdir(quarantineDir, { recursive: true });
  const destPath = join(quarantineDir, `${Date.now()}_${basename(filePath)}`);
  await rename(filePath, destPath);
  await chmod(destPath, 0o000);
  return destPath;
}

export async function restore(quarantinedPath: string, originalPath: string): Promise<void> {
  const { rename, chmod } = await import('node:fs/promises');
  await chmod(quarantinedPath, 0o644);
  await rename(quarantinedPath, originalPath);
}
