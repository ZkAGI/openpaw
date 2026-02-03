// ZK Prover — Circom + Groth16 ONLY. Never SP1 or zkVM.
import { z } from 'zod';

export const ProofSchema = z.object({
  pi_a: z.tuple([z.string(), z.string(), z.string()]),
  pi_b: z.tuple([
    z.tuple([z.string(), z.string()]),
    z.tuple([z.string(), z.string()]),
    z.tuple([z.string(), z.string()]),
  ]),
  pi_c: z.tuple([z.string(), z.string(), z.string()]),
  protocol: z.literal('groth16'),
  curve: z.literal('bn128'),
});

export type Proof = z.infer<typeof ProofSchema>;

export const PublicSignalsSchema = z.array(z.string());
export type PublicSignals = z.infer<typeof PublicSignalsSchema>;

export interface ProverConfig {
  wasmPath: string;
  zkeyPath: string;
}

export interface VerifierConfig {
  verificationKeyPath: string;
}

export async function prove(
  input: Record<string, bigint | number | string>,
  config: ProverConfig
): Promise<{ proof: Proof; publicSignals: PublicSignals }> {
  const snarkjs = await import('snarkjs');
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    config.wasmPath,
    config.zkeyPath
  );
  return {
    proof: ProofSchema.parse(proof),
    publicSignals: PublicSignalsSchema.parse(publicSignals),
  };
}

export async function verify(
  proof: Proof,
  publicSignals: PublicSignals,
  config: VerifierConfig
): Promise<boolean> {
  const snarkjs = await import('snarkjs');
  const { readFile } = await import('node:fs/promises');
  const vkeyJson = await readFile(config.verificationKeyPath, 'utf8');
  const vkey = JSON.parse(vkeyJson) as Record<string, unknown>;
  return snarkjs.groth16.verify(vkey, publicSignals, proof as unknown);
}

// Circuit constraint budgets:
// - instruction_match: ~200 constraints
// - policy_check: ~150 constraints
// - credential_proof: ~150 constraints
// Total: ~500 constraints, proving <100ms
