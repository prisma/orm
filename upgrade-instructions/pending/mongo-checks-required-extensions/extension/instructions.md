---
changes:
  - id: mongo-execution-context-checks-contract-requirements
    summary: |
      `createMongoExecutionContext` from `@prisma/orm-mongo/family-runtime` refuses a contract its stack cannot serve: `RUNTIME.CONTRACT_FAMILY_MISMATCH` for a contract of another family, `RUNTIME.CONTRACT_TARGET_MISMATCH` for another target, and `RUNTIME.MISSING_EXTENSION_PACK` for a contract that requires an extension pack the stack does not hold. The MongoDB adapter's runtime descriptor now encodes with the codecs of every extension in the stack, so an extension's codec `toWire` runs on writes.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateMongoExecutionContext\b'
        - '\bMongoRuntimeExtensionDescriptor\b'
---

# MongoDB execution contexts check the contract against the stack

## `mongo-execution-context-checks-contract-requirements`

1. Where code calls `createMongoExecutionContext({ contract, stack })` with a contract that requires extension packs, build the stack with those packs: `createMongoExecutionStack({ target, adapter, extensions: [myPack] })`.
2. A MongoDB extension's codecs now encode values on writes as well as decode them on reads. Check that each codec's `toWire` returns the form the database stores, and that `fromWire` reads that form back. Build codecs and the registry `codecs()` returns with `mongoCodec` and `newMongoCodecRegistry` from `@prisma/orm-family-mongo/codec`.
