import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectAgents, formatDetectResultAsJson, AgentInfoSchema } from './index.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('detectAgents', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `openpaw-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true });
  });

  it('should return empty agents for empty directory', async () => {
    const result = await detectAgents(testDir);

    expect(result.agents).toEqual([]);
    expect(result.directory).toBe(testDir);
    expect(result.scannedAt).toBeInstanceOf(Date);
  });

  it('should detect Claude agent from CLAUDE.md', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Claude Instructions\n');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('claude');
    expect(result.agents[0].type).toBe('claude');
    expect(result.agents[0].configFiles).toContain('CLAUDE.md');
    expect(result.agents[0].path).toBe(testDir);
  });

  it('should detect Claude agent from .claude directory', async () => {
    await mkdir(join(testDir, '.claude'), { recursive: true });

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('claude');
    expect(result.agents[0].type).toBe('claude');
    expect(result.agents[0].configFiles).toContain('.claude');
  });

  it('should detect Cursor agent from .cursorrules', async () => {
    await writeFile(join(testDir, '.cursorrules'), 'cursor rules content');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('cursor');
    expect(result.agents[0].type).toBe('cursor');
    expect(result.agents[0].configFiles).toContain('.cursorrules');
  });

  it('should detect Cline agent from .clinerules', async () => {
    await writeFile(join(testDir, '.clinerules'), 'cline rules content');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('cline');
    expect(result.agents[0].type).toBe('cline');
    expect(result.agents[0].configFiles).toContain('.clinerules');
  });

  it('should detect Windsurf agent from .windsurfrules', async () => {
    await writeFile(join(testDir, '.windsurfrules'), 'windsurf rules content');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('windsurf');
    expect(result.agents[0].type).toBe('windsurf');
    expect(result.agents[0].configFiles).toContain('.windsurfrules');
  });

  it('should detect multiple agents in same directory', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Claude');
    await writeFile(join(testDir, '.cursorrules'), 'cursor');
    await writeFile(join(testDir, '.clinerules'), 'cline');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(3);
    const names = result.agents.map((a) => a.name).sort();
    expect(names).toEqual(['claude', 'cline', 'cursor']);
  });

  it('should detect multiple config files for same agent', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Claude');
    await mkdir(join(testDir, '.claude'), { recursive: true });
    await writeFile(join(testDir, '.claude.json'), '{"version": "1.0.0"}');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('claude');
    expect(result.agents[0].configFiles).toHaveLength(3);
    expect(result.agents[0].configFiles).toContain('CLAUDE.md');
    expect(result.agents[0].configFiles).toContain('.claude');
    expect(result.agents[0].configFiles).toContain('.claude.json');
  });

  it('should extract version from JSON config files', async () => {
    await writeFile(join(testDir, 'claude.json'), JSON.stringify({ version: '2.5.0' }));

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].version).toBe('2.5.0');
  });

  it('should detect unknown agent-like directories with config files', async () => {
    await mkdir(join(testDir, '.myagent'), { recursive: true });
    await writeFile(join(testDir, '.myagent', 'config.json'), '{}');

    const result = await detectAgents(testDir);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('myagent');
    expect(result.agents[0].type).toBe('unknown');
    expect(result.agents[0].configFiles).toContain('.myagent/config.json');
  });

  it('should validate agent info against schema', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Claude');

    const result = await detectAgents(testDir);

    // Each detected agent should be valid according to the schema
    for (const agent of result.agents) {
      const validated = AgentInfoSchema.safeParse(agent);
      expect(validated.success).toBe(true);
    }
  });
});

describe('formatDetectResultAsJson', () => {
  it('should format result as valid JSON', async () => {
    const testDir = join(tmpdir(), `openpaw-detect-json-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, 'CLAUDE.md'), '# Claude');

    try {
      const result = await detectAgents(testDir);
      const jsonOutput = formatDetectResultAsJson(result);

      // Should be valid JSON
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.agents).toHaveLength(1);
      expect(parsed.agents[0].name).toBe('claude');
      expect(typeof parsed.scannedAt).toBe('string');
      expect(parsed.directory).toBe(testDir);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
