---
changes:
  - id: mongo-client-takes-extensions
    summary: |
      `mongo()` and `mongoStatic()` from `@prisma/orm-mongo` take an `extensions` option, as `postgres()` does, and refuse a contract that requires an extension pack they are not given, with `RUNTIME.MISSING_EXTENSION_PACK`. A MongoDB project whose `prisma.config.ts` composes extension packs passes each pack's runtime descriptor to `mongo({ extensions })` and `mongoStatic({ extensions })`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-mongo/config)[\s\S]*[{,]\s{0,100}extensions\s{0,20}[:,}]'
  - id: mongo-contract-requires-target
    summary: |
      A MongoDB `contract.json` must have `"target"`, as a SQL contract must. `contractFromJson`, `mongo()` and `mongoStatic()` refuse a contract without it with `CONTRACT.VALIDATION_FAILED`. Every contract `prisma contract emit` writes has it, so only a hand-written or hand-edited contract is affected.
    detection:
      glob: "**/*.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"target"\s*:)[\s\S]*"targetFamily"\s*:\s*"mongo"'
---

# `mongo()` checks the extension packs a contract requires

A contract built with extension packs records them, and `mongo()` and `mongoStatic()` now refuse it unless they are given the same packs:

```typescript
import mongo from '@prisma/orm-mongo/runtime';
import myPack from 'my-mongo-pack/runtime';

export const db = mongo({ contract, url, extensions: [myPack] });
```

## `mongo-client-takes-extensions`

1. For each extension pack in `extensions` in `prisma.config.ts`, import the pack's runtime descriptor, usually from its `/runtime` entry.
2. Pass the descriptors as `extensions` to every `mongo(...)` and `mongoStatic(...)` call that takes this project's contract.

## `mongo-contract-requires-target`

Re-emit the contract with `prisma contract emit`, or add `"target": "mongo"` beside `"targetFamily": "mongo"` in a contract written by hand.
