declare module 'snarkjs' {
  export namespace groth16 {
    function fullProve(
      input: Record<string, bigint | number | string>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: unknown; publicSignals: string[] }>;

    function verify(
      vkey: Record<string, unknown>,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;
  }
}
