# ADR 188 — MongoDB migration operation model: data-driven commands and checks

> **Update — 2026-10:** document rewrites the planner writes for `--rename` and `--delete` statements are classed by their effect, not as `data`. See § DML operations and unified check shape.

## Grounding example

The migration planner has compared two contracts and determined that a unique ascending index on `users.email` needs to be created. It needs to produce an operation that the runner can execute.

But the operation isn't just "create this index." Three things must happen:

1. **Before** mutating: verify the index doesn't already exist (to avoid errors on re-run)
2. **Execute**: create the index
3. **After** mutating: verify the unique index now exists (to confirm success)

These three concerns — precheck, execute, postcheck — must be captured as data that can be persisted to a JSON file (`ops.json`), loaded later by a generic runner, and executed without the runner knowing anything about indexes specifically.

Here is what the operation looks like:

```ts
const op: MongoMigrationPlanOperation = {
  id: 'index.users.create(email_1)',
  label: 'Create index email_1 on users (email:1)',
  operationClass: 'additive',
  precheck: [
    {
      description: 'no index named email_1 exists on users',
      source: new ListIndexesCommand('users'),
      filter: MongoFieldFilter.eq('name', 'email_1'),
      expect: 'notExists',
    },
  ],
  execute: [
    {
      description: 'create index',
      command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        name: 'email_1',
      }),
    },
  ],
  postcheck: [
    {
      description: 'index email_1 exists on users',
      source: new ListIndexesCommand('users'),
      filter: MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'email_1'),
        MongoFieldFilter.eq('key', { email: 1 }),
        MongoFieldFilter.eq('unique', true),
      ]),
      expect: 'exists',
    },
  ],
};
```

Every piece — `CreateIndexCommand`, `ListIndexesCommand`, `MongoFieldFilter`, `MongoAndExpr` — is a frozen AST node with plain-property fields. The runner doesn't need to know this is an index operation. It runs the same three-phase loop for every operation: evaluate prechecks, dispatch execute commands, evaluate postchecks.

## Decision

Each migration operation is a **data envelope** with three phases — `precheck[]`, `execute[]`, `postcheck[]` — rather than a behavioral class with per-operation visitor dispatch. The phases are composed from existing AST primitives (DDL commands, inspection commands, filter expressions) that serialize naturally to JSON. The envelope carries no behavior of its own; the semantic richness lives in the commands and expressions inside it.

```text
Planner                                              Runner
   │                                                    │
   ▼                                                    ▼
Operation (live AST objects)                      Load ops.json
   │                                                    │
   ▼                                                    ▼
JSON.stringify ──────▶ ops.json ──────▶ deserialize (rehydrate)
                                                        │
                                                        ▼
                                              Operation (live AST objects)
                                                        │
                                              ┌─────────┼──────────┐
                                              ▼         ▼          ▼
                                          precheck   execute   postcheck
```

## The envelope

The envelope is a plain interface — no `kind` discriminant, no visitor, no class hierarchy:

```ts
interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
```

The three base fields (`id`, `label`, `operationClass`) satisfy the framework's `MigrationPlanOperation` interface, so the CLI and migration tooling can work with these operations without knowing they're Mongo-specific.

### Execute steps

Each step wraps a DDL command AST node:

```ts
interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}
```

The command vocabulary is `CreateIndexCommand`, `DropIndexCommand`, `CreateCollectionCommand`, `DropCollectionCommand`, and `CollModCommand`. All follow the same `MongoAstNode` pattern: frozen, `kind`-discriminated, `accept(visitor)` for dispatch. Adding a new command means one new class and one new case in the command executor — not a new operation type.

### Checks

Each check composes three pieces:

```ts
interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}
```

- **`source`** — an inspection command (`ListIndexesCommand`, `ListCollectionsCommand`) that queries the database and returns result documents.
- **`filter`** — a `MongoFilterExpr` applied client-side to the results. This reuses the existing filter expression AST from `@internal/mongo-query-ast` — the same `$eq`, `$and`, `$or`, `$not`, `$exists`, `$gt`, `$in` vocabulary used in query `$match` stages. We reuse it because it's already built, tested, serializable, and familiar to anyone who knows MongoDB query syntax.
- **`expect`** — `'exists'` means at least one result matches; `'notExists'` means none match.

This gives checks the same expressive power as MongoDB query filters, without inventing a separate vocabulary.

### DML operations and unified check shape

The envelope described above covers DDL operations — creating indexes, modifying collections. DML operations, which read and write documents (backfills, field renames and removals, seed inserts), use the same three-phase envelope but carry different payloads. A data transform is a DML operation built with `dataTransform`.

```ts
interface MongoDmlOperation extends MigrationPlanOperation {
  readonly operationClass: MigrationOperationClass;
  readonly name: string;
  readonly precheck: readonly MongoDmlCheck[];
  readonly run: readonly MongoQueryPlan[];
  readonly postcheck: readonly MongoDmlCheck[];
}
```

A transform built with `dataTransform`, whether a user writes it or the planner scaffolds it with a placeholder, has `operationClass: 'data'`. The `renameField` and `unsetField` rewrites carry the class of their effect, whoever writes them, as every other operation does: `renameField` is `widening` and `unsetField` is `destructive`. So `db update`, which does not allow `data`, can run a rename. The runner and the serializer tell a DML operation from a DDL operation by its shape (`run` against `execute`), not by its class. The `run` array contains `MongoQueryPlan` objects — aggregation pipelines or raw commands (`rawUpdateMany`, `rawInsertOne`, etc.) — rather than DDL commands. The `precheck` and `postcheck` arrays contain `MongoDmlCheck` objects instead of `MongoMigrationCheck`.

`MongoDmlCheck` has the same four-field shape as `MongoMigrationCheck`:

```ts
interface MongoDmlCheck {
  readonly description: string;
  readonly source: MongoQueryPlan;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}
```

The only difference is the `source` type: `MongoQueryPlan` (an aggregation or raw command) instead of `AnyMongoInspectionCommand`. Both use `MongoFilterExpr` for `filter` and `'exists' | 'notExists'` for `expect`. Both are evaluated by the same `FilterEvaluator` path in the runner — run the source query, apply the filter client-side, check against the expectation.

The two types are kept concrete rather than collapsed into a generic `MigrationCheck<TSource>` because the source types need different executors — DDL checks dispatch through `MongoInspectionCommandVisitor`, DML checks dispatch through `MongoAdapter.lower()` → `MongoDriver.execute()`. Two concrete types with a shared shape let the runner dispatch internally based on which operation type it's processing.

#### One factory derives both precheck and postcheck

The `dataTransform` factory takes a single `check` configuration and produces both precheck and postcheck arrays by flipping `expect`:

```ts
dataTransform('backfill-status', {
  check: {
    source: () => agg.from('users').match((f) => f.status.exists(false)).limit(1),
    expect: 'exists',
  },
  run: () => raw.collection('users')
    .updateMany({ status: { $exists: false } }, { $set: { status: 'active' } }),
})
```

The factory resolves this into a precheck with `expect: 'exists'` (violations found — run the transform) and a postcheck with `expect: 'notExists'` (no violations remain — transform succeeded). This gives idempotency and verification from a single check specification. Omitting `check` entirely produces empty arrays — always run, no idempotency guard.

#### DML execution

DML `run` commands execute via `MongoAdapter.lower()` → `MongoDriver.execute()` — the same adapter+driver transport used for runtime queries. No bespoke DML executor is needed; the adapter lowers each `MongoQueryPlan` to a wire command, and the driver executes it against the database.

#### Relationship to the generic envelope

Both DDL and DML operations are specializations of the generic three-phase migration operation envelope described in [ADR 191](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md). The DDL variant fills the phases with inspection commands, DDL commands, and `MongoMigrationCheck`; the DML variant fills them with query plans and `MongoDmlCheck`. The runner processes both through the same three-phase loop.

## Serialization

Because all AST nodes are frozen plain-property objects, `JSON.stringify` produces the persisted format directly. For example, the precheck from the grounding example serializes as:

```json
{
  "description": "index does not already exist",
  "source": { "kind": "listIndexes", "collection": "users" },
  "filter": { "kind": "field", "field": "key", "op": "$eq", "value": { "email": 1 } },
  "expect": "notExists"
}
```

The execute and postcheck phases follow the same pattern — each AST node serializes to a `kind`-discriminated JSON object.

On the deserialization side, the runner walks the JSON, matches `kind` discriminants, validates structure with Arktype schemas, and reconstructs live class instances. The rehydrated objects are indistinguishable from the originals — a `CreateIndexCommand` deserialized from JSON has the same `accept(visitor)` method and frozen properties as one constructed in code. This means the command executor, CLI formatter, or any future consumer can work with rehydrated operations identically to planner-produced ones.

## Composability

Because operations are composed from a small set of serializable primitives, anything that can assemble those primitives can produce a valid operation. The planner does this automatically by diffing contracts. But the same primitives are available to other producers:

- **Hand-authored migrations** — a user could assemble an operation from the same building blocks the planner uses. The framework serializes it to `ops.json` and the runner executes it, without any special handling.
- **Extension packs** — a target-specific extension could contribute new command kinds (e.g. `CreateSearchIndexCommand`). As long as the command executor and deserializer handle the new `kind`, existing operations continue to work.

## Alternatives considered

### Behavioral operation classes

An earlier design had each migration operation as its own class (`CreateIndexOp`, `DropIndexOp`) with a visitor interface. The runner would call `op.accept(executor)` and dispatch to a per-operation handler. We chose the data-driven envelope instead because:

- **The commands already carry the semantics.** A `CreateIndexCommand` fully describes what to do. Wrapping it in a `CreateIndexOp` duplicates the structure.
- **Checks become inspectable data.** In the behavioral design, pre/postchecks were runtime logic inside the visitor — invisible in the plan file and untestable in isolation. The data-driven design makes them part of the serialized plan.
- **The runner stays generic.** It runs the same three-phase loop for every operation. No visitor, no per-operation dispatch.
- **Adding a new DDL command is cheap.** One new class and one new case in the command executor — not a new operation class, visitor method, union member, and deserializer branch.

### Purpose-built check vocabulary

We could have invented check-specific types: `{ kind: 'indexExists', collection: 'users', keys: { email: 1 } }`. We chose `MongoFilterExpr` instead because:

- **Already exists.** The filter expression AST is fully defined, tested, and serializable.
- **Familiar.** The same expressions appear in MongoDB queries (`$match`, `find()`).
- **Expressive.** `$eq`, `$gt`, `$in`, `$and`, `$or`, `$not`, `$exists` — far richer than any purpose-built vocabulary we would realistically build.

The trade-off is a client-side filter evaluator, which is straightforward and also useful for testing and dry-run simulation.

### Embedding display strings in the plan

We could add a `displayCommands: string[]` field to each operation, populated by the planner. This would couple plan data to CLI presentation and bloat the persisted format. Instead, the CLI uses a visitor-based formatter that produces display strings from the live DDL command objects after rehydration.
