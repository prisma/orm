---
changes:
  - id: mongo-execution-context-checks-contract-requirements
    summary: |
      `createMongoExecutionContext` from `@prisma/orm-mongo/family-runtime` refuses a contract its stack cannot serve: `RUNTIME.CONTRACT_FAMILY_MISMATCH` for a contract of another family, `RUNTIME.CONTRACT_TARGET_MISMATCH` for another target, and `RUNTIME.MISSING_EXTENSION_PACK` for a contract that requires an extension pack the stack does not hold. The MongoDB adapter's runtime descriptor now encodes with the codecs of every extension in the stack, so an extension's codec `toWire` runs on writes.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcreateMongoExecutionContext\b'
        - '\bMongoRuntimeExtensionDescriptor\b'
  - id: mongo-codecs-declared-once
    summary: |
      A MongoDB target, adapter or extension descriptor declares each codec once, as a codec descriptor in `types.codecTypes.codecDescriptors`, as a Postgres extension does. The `codecs()` slot that returned a `MongoCodecRegistry` is gone from `MongoStaticContributions`, `MongoRuntimeTargetDescriptor`, `MongoRuntimeAdapterDescriptor` and `MongoRuntimeExtensionDescriptor`. The runtime, the adapter and the migration runner take each codec from its descriptor with `assembleMongoCodecRegistry`. Build a descriptor from a codec with `mongoCodecDescriptor` from `@prisma/orm-family-mongo/codec`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bMongoRuntime(?:Extension|Target|Adapter)Descriptor\b(?:<[^<>]{0,200}>)?\s{0,20}(?:=>?|\{\s{0,20}return)\s{0,20}\(?\s{0,20}\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bcodecs\s{0,20}[:(]'
        - '\bfamilyId\s{0,20}:\s{0,20}[''"]mongo[''"](?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bcodecs\s{0,20}[:(]'
        - '\bcodecs\s{0,20}[:(](?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bfamilyId\s{0,20}:\s{0,20}[''"]mongo[''"]'
        - '(?<![\s\S])(?=[\s\S]*?\b(?:newMongoCodecRegistry|MongoCodecRegistry)\b)[\s\S]*?\{(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?(?:\.\.\.(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\bcodecs\s{0,20}(?::\s{0,20}(?:(?:async\s{1,20})?(?:\([^()]{0,200}\)|[\w$]{1,100})\s{0,20}=>|function\b|newMongoCodecRegistry\b(?!\s{0,20}\())|\([^()]{0,200}\)\s{0,20}(?::[^{};]{0,200})?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})|\bcodecs\s{0,20}(?::\s{0,20}(?:(?:async\s{1,20})?(?:\([^()]{0,200}\)|[\w$]{1,100})\s{0,20}=>|function\b|newMongoCodecRegistry\b(?!\s{0,20}\())|\([^()]{0,200}\)\s{0,20}(?::[^{};]{0,200})?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\.\.\.)(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\}'
  - id: mongo-standard-codecs-removed
    summary: |
      `mongoStandardCodecs` and `buildStandardCodecRegistry` are gone from `@prisma/orm-mongo/target/codecs`. The target declares its codecs once, in `mongoCodecDescriptors`. A registry of them is `assembleMongoCodecRegistry([mongoRuntimeTarget])`, with `assembleMongoCodecRegistry` from `@prisma/orm-family-mongo/codec` and the target from `@prisma/orm-mongo/target/runtime`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\b(?:mongoStandardCodecs|buildStandardCodecRegistry)\b'
---

# MongoDB execution contexts check the contract against the stack

## `mongo-execution-context-checks-contract-requirements`

1. Where code calls `createMongoExecutionContext({ contract, stack })` with a contract that requires extension packs, build the stack with those packs: `createMongoExecutionStack({ target, adapter, extensions: [myPack] })`.
2. A MongoDB extension's codecs now encode values on writes as well as decode them on reads. Check that each codec's `toWire` returns the form the database stores, and that `fromWire` reads that form back.

## `mongo-codecs-declared-once`

Replace the `codecs()` slot of a MongoDB descriptor with one codec descriptor per codec, shared by the pack and the runtime descriptor:

```typescript
import { mongoCodec, mongoCodecDescriptor } from '@prisma/orm-family-mongo/codec';

const shoutCodec = mongoCodec({ typeId: 'shout/text@1', dataType: shoutText, toWire, fromWire, fromDataTypeValue });

const shoutMeta = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutText],
  types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(shoutCodec, { traits: ['equality'] })] } },
} as const;

export const shoutRuntime: MongoRuntimeExtensionDescriptor<'mongo'> = {
  ...shoutMeta,
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};
```

1. For each codec the `codecs()` registry held, add `mongoCodecDescriptor(codec, { traits })` to `types.codecTypes.codecDescriptors`, with the traits the pack declared for it. If the pack already lists a hand-written descriptor for the codec, replace it with this one.
2. Delete `codecs` from the descriptor.
3. Make the runtime and control descriptors spread the same metadata as the pack, so all three list the same descriptors and `dataTypes`.

## `mongo-standard-codecs-removed`

1. Replace `buildStandardCodecRegistry()` with `assembleMongoCodecRegistry([mongoRuntimeTarget])`.
2. Replace a read of `mongoStandardCodecs` with the registry: `registry.get(codecId)` for one codec, `[...registry]` for all of them, or with `mongoCodecDescriptors` where only the codec ids or metadata are needed.
