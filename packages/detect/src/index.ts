import { z } from 'zod';

export const AgentInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['claude', 'cursor', 'cline', 'windsurf', 'unknown']),
  configPath: z.string(),
  version: z.string().optional(),
});

export type AgentInfo = z.infer<typeof AgentInfoSchema>;

export interface DetectResult {
  agents: AgentInfo[];
  scannedAt: Date;
  directory: string;
}

export async function detectAgents(directory: string): Promise<DetectResult> {
  // TODO: Implement agent detection
  return {
    agents: [],
    scannedAt: new Date(),
    directory,
  };
}
