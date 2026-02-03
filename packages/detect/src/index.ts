import { z } from 'zod';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export const AgentInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['claude', 'cursor', 'cline', 'windsurf', 'unknown']),
  path: z.string(),
  configFiles: z.array(z.string()),
  version: z.string().optional(),
});

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export interface DetectResult {
  agents: AgentInfo[];
  scannedAt: Date;
  directory: string;
}

// Known agent configuration patterns
const AGENT_CONFIG_PATTERNS: Record<string, { type: AgentInfo['type']; files: string[] }> = {
  claude: {
    type: 'claude',
    files: ['.claude', 'CLAUDE.md', '.clauderc', 'claude.json', '.claude.json'],
  },
  cursor: {
    type: 'cursor',
    files: ['.cursor', '.cursorrc', 'cursor.json', '.cursorrules'],
  },
  cline: {
    type: 'cline',
    files: ['.cline', 'cline.json', '.clinerules', '.clineignore'],
  },
  windsurf: {
    type: 'windsurf',
    files: ['.windsurf', 'windsurf.json', '.windsurfrules'],
  },
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function tryReadVersion(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf8');
    // Try to parse as JSON and extract version
    const parsed = JSON.parse(content);
    if (typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    // Not JSON or no version field
  }
  return undefined;
}

export async function detectAgents(directory: string): Promise<DetectResult> {
  const agents: AgentInfo[] = [];
  const scannedAt = new Date();

  // Check for each known agent type
  for (const [agentName, config] of Object.entries(AGENT_CONFIG_PATTERNS)) {
    const foundFiles: string[] = [];
    let version: string | undefined;

    for (const configFile of config.files) {
      const fullPath = join(directory, configFile);
      if (await fileExists(fullPath)) {
        foundFiles.push(configFile);
        // Try to extract version from JSON config files
        if (configFile.endsWith('.json') && !version) {
          version = await tryReadVersion(fullPath);
        }
      }
    }

    if (foundFiles.length > 0) {
      agents.push({
        name: agentName,
        type: config.type,
        path: directory,
        configFiles: foundFiles,
        ...(version && { version }),
      });
    }
  }

  // Also scan for any unknown agent-like directories
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.')) {
        // Check if it looks like an agent config directory
        const dirPath = join(directory, entry.name);
        const potentialConfigs = ['config.json', 'settings.json', 'rules.md'];
        const foundConfigs: string[] = [];

        for (const config of potentialConfigs) {
          if (await fileExists(join(dirPath, config))) {
            foundConfigs.push(`${entry.name}/${config}`);
          }
        }

        // If it has config files and isn't already detected
        if (foundConfigs.length > 0) {
          const normalizedName = entry.name.replace(/^\./, '').toLowerCase();
          const alreadyDetected = agents.some((a) => a.name === normalizedName);
          if (!alreadyDetected) {
            agents.push({
              name: normalizedName,
              type: 'unknown',
              path: dirPath,
              configFiles: foundConfigs,
            });
          }
        }
      }
    }
  } catch {
    // Directory might not be readable
  }

  return {
    agents,
    scannedAt,
    directory,
  };
}

// Export for CLI JSON output
export function formatDetectResultAsJson(result: DetectResult): string {
  return JSON.stringify(
    {
      agents: result.agents,
      scannedAt: result.scannedAt.toISOString(),
      directory: result.directory,
    },
    null,
    2
  );
}
