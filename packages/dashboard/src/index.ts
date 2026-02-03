import { z } from 'zod';

export const StatusSchema = z.object({
  services: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['running', 'stopped', 'error']),
      uptime: z.number().optional(),
    })
  ),
  vault: z.object({
    credentialCount: z.number(),
    lastAccess: z.string().optional(),
  }),
  scanner: z.object({
    lastScan: z.string().optional(),
    findingsCount: z.number(),
  }),
});

export type Status = z.infer<typeof StatusSchema>;

export async function getStatus(): Promise<Status> {
  // TODO: Aggregate status from all services
  return {
    services: [],
    vault: { credentialCount: 0 },
    scanner: { findingsCount: 0 },
  };
}

export const DoctorCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['PASS', 'FAIL', 'WARN']),
  message: z.string(),
});

export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  checks.push({
    name: 'Node.js version',
    status: nodeVersion.startsWith('v20') || nodeVersion.startsWith('v22') ? 'PASS' : 'WARN',
    message: `Node.js ${nodeVersion}`,
  });

  // TODO: Add more checks for dependencies, permissions, configs
  return checks;
}
