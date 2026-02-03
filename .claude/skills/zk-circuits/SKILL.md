---
name: zk-circuits
description: Circom circuit development. Activates for ZK, circuit, proof, snarkjs, circom tasks.
---

# ZK Circuit Development — Circom + Groth16

## YOU MUST use Circom. Never SP1 or zkVM.

## Circuit Template
```circom
pragma circom 2.0.0;
include "circomlib/circuits/poseidon.circom";

template InstructionMatch() {
    signal input instruction_hash;
    signal input expected_hash;
    signal output match;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== instruction_hash;

    match <== 1 - (hasher.out - expected_hash);
}
component main = InstructionMatch();
```

## Testing with circom_tester
```typescript
import { wasm } from 'circom_tester';
import path from 'path';

const circuit = await wasm(path.join(__dirname, '../circuits/instruction_match.circom'));
const witness = await circuit.calculateWitness({ instruction_hash: 42, expected_hash: 42 });
await circuit.checkConstraints(witness);
```

## Compile & Setup
```bash
circom circuits/name.circom --r1cs --wasm --sym -o build/
snarkjs groth16 setup build/name.r1cs pot12_final.ptau keys/name.zkey
snarkjs zkey export verificationkey keys/name.zkey keys/name_vkey.json
```

## Verification: After writing any circuit
- Check constraint count: `snarkjs r1cs info build/name.r1cs`
- Must be <500 constraints total across all 3 circuits
- Proving time must be <100ms (use vitest bench)
