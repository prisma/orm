---
changes:
  - id: mongo-execution-context-applies-mutation-defaults
    summary: |
      `MongoExecutionContext` gains a required `applyMutationDefaults(options)` method, which fills
      the contract's execution defaults on ORM writes. Contexts built with
      `createMongoExecutionContext` have it; an object literal typed as a `MongoExecutionContext`
      (usually a test double) must add it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?:\)|\b\w+)\s*:\s*MongoExecutionContext\b(?:<[^>]*>)?\s*(?:=\s*\{|\{)'
        - '\bsatisfies\s+MongoExecutionContext\b'
---

## `mongo-execution-context-applies-mutation-defaults`

Mongo contracts can now carry execution defaults (`temporal.createdAt()`, `temporal.updatedAt()`), and the execution context applies them. The ORM calls `context.applyMutationDefaults(...)` on every create and update, so `MongoExecutionContext` has a new required method.

Build contexts with `createMongoExecutionContext({ contract, stack })` and nothing changes. A hand-written context, typically a test double, adds a method that applies nothing:

```ts
// before
const context: MongoExecutionContext = { contract, codecs, stack };

// after
const context: MongoExecutionContext = { contract, codecs, stack, applyMutationDefaults: () => [] };
```
