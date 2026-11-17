---
changes:
  - id: rename-statements-capability-removed
    summary: |
      `TargetMigrationsCapability.renameStatements` (with `refused` and `keepDataByHand`), added in 8.0.0-rc.17, is removed: every target's planner carries out rename statements. The CLI no longer appends a target's text to a data-loss question.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:renameStatements|keepDataByHand)\s*:'
  - id: mongo-ddl-rename-collection
    summary: |
      `MongoDdlCommandVisitor` gains `renameCollection(command: RenameCollectionCommand)`, and `AnyMongoDdlCommand` and `AnyMongoDdlWireCommand` gain `RenameCollectionCommand` and `RenameCollectionWireCommand` (source in `collection`, new name in `to`). A visitor implementation, or a driver's `run`, handles the new kind.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:MongoDdlCommandVisitor|AnyMongoDdlCommand|AnyMongoDdlWireCommand)(?![\w$])'
  - id: mongo-dml-operations
    summary: |
      `MongoDataTransformOperation` is renamed `MongoDmlOperation`, and `MongoDataTransformCheck` `MongoDmlCheck`. Its `operationClass` is any `MigrationOperationClass`, not only `'data'`: the planner's document rewrites (`renameField`, `unsetField`) are DML operations with class `widening` or `destructive`. Tell a DML operation from a DDL operation with `isMongoDmlOperation(operation)` (it has `run`), not with `operationClass === 'data'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'operationClass\s*===?\s*["'']data["'']'
        - '(?<![\w$])MongoDataTransform(?:Operation|Check)(?![\w$])'
  - id: mongo-update-many-bypass-validation
    summary: |
      `RawUpdateManyCommand` takes an optional fourth argument `{ bypassDocumentValidation }`; `UpdateManyWireCommand` takes it as an optional fifth constructor argument and carries `bypassDocumentValidation: boolean`; the lowered `rawUpdateMany` draft (`MongoLoweredDraft`) requires `bypassDocumentValidation: boolean`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'kind:\s*["'']rawUpdateMany["'']'
  - id: mongo-op-factory-call-to-op
    summary: |
      A Mongo `OpFactoryCall`'s `toOp()`, and `renderOps(calls)`, return `AnyMongoMigrationOperation`, since `RenameFieldCall` and `UnsetFieldCall` produce DML operations.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '["'']@(?:prisma/orm-target-mongo|internal/target-mongo)(?:/[^"'']*)?["''][\s\S]*(?:\.toOp\(\)|(?<![\w$])renderOps\s*\()'
---

# MongoDB carries out `--rename` and `--delete`

## `rename-statements-capability-removed`

Delete `renameStatements` from a target's `migrations` capability, and any `keepDataByHand` function it pointed at. A test double of the capability that set it drops the member. A data-loss question now offers `rename` for a model or field the destination no longer has on every target; write a planner that carries out the resolved statements it is given, or refuses each with a `statementRefused` conflict that carries it in `refusedStatement`.

## `mongo-ddl-rename-collection`

The DDL command alphabet gains a collection rename:

```ts
import { RenameCollectionCommand } from '@prisma/orm-family-mongo/query-ast/control';

new RenameCollectionCommand('profiles', 'users');
```

A `MongoDdlCommandVisitor<R>` implementation adds `renameCollection(command)`. A Mongo driver's `run(wireCommand)` handles `kind: 'renameCollection'`, as the shipped driver does with `db.renameCollection(collection, to)`, without `dropTarget`. An adapter's DDL lowering maps the command to `new RenameCollectionWireCommand(command.collection, command.to)`.

## `mongo-dml-operations`

Rename the types where code names them:

```diff
- import type { MongoDataTransformCheck, MongoDataTransformOperation } from '@prisma/orm-family-mongo/query-ast/control';
+ import type { MongoDmlCheck, MongoDmlOperation } from '@prisma/orm-family-mongo/query-ast/control';
```

Where code narrows `AnyMongoMigrationOperation` by `operation.operationClass === 'data'`, use the guard instead:

```diff
- if (operation.operationClass === 'data') {
+ if (isMongoDmlOperation(operation)) {
```

`isMongoDmlOperation` comes from `@prisma/orm-family-mongo/query-ast/control`. An operation without `run` is a DDL operation. The `dataTransform` factory keeps its name: it builds a DML operation with class `data`. A hand-written `dataTransform` still has class `data`, so a policy that leaves out `data` (as `db update`'s does) still refuses it, and runs `renameField` and `unsetField`.

## `mongo-update-many-bypass-validation`

A hand-built lowered draft of kind `rawUpdateMany` adds `bypassDocumentValidation: false`. A driver's `updateMany` passes `bypassDocumentValidation: true` to MongoDB when the wire command carries it.

## `mongo-op-factory-call-to-op`

Code typed against the result of `toOp()` or `renderOps(...)` as `MongoMigrationPlanOperation` widens it to `AnyMongoMigrationOperation`, and narrows with `isMongoDmlOperation` where it needs `execute` or `run`.
