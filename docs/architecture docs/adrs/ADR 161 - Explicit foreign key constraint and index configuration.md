# ADR 161 — Explicit foreign key constraint and index configuration

> **Status: superseded — foreign keys and indexes are discrete contract entities.** The per-FK `constraint` and `index` booleans decided below are retained as the record of the original design; the corrected decision and its rationale are in [Foreign keys and indexes are discrete entities](#foreign-keys-and-indexes-are-discrete-entities) immediately below, and its implementation in [A foreign key names its backing index](#a-foreign-key-names-its-backing-index).

## Foreign keys and indexes are discrete entities

A foreign key is a referential constraint; an index is an index. The contract carries each as its own entity, and if one is absent it is simply absent — never a boolean on the other.

The JSON below illustrates the model as first proposed. The implemented shape adds one field, the foreign key's `index`, described in [A foreign key names its backing index](#a-foreign-key-names-its-backing-index).

```jsonc
// A FK whose columns have a backing index — two discrete facts:
"foreignKeys": [
  { "name": "identities_user_id_fkey", "source": { "columns": ["user_id"] },
    "target": { "tableName": "users", "columns": ["id"] }, "onDelete": "cascade" }
],
"indexes": [
  { "name": "identities_user_id_idx", "columns": ["user_id"] }
]

// A FK with no backing index — the index entity is simply absent:
"foreignKeys": [
  { "name": "mfa_amr_claims_session_id_fkey", "source": { "columns": ["session_id"] },
    "target": { "tableName": "sessions", "columns": ["id"] }, "onDelete": "cascade" }
]
```

### Why the boolean cannot stand

Ask the emitted contract one question: *a foreign key has a backing index — what is that index's name?* The `index: true` boolean cannot answer. It can only ever mean "the index this FK would be given by deterministic naming ([ADR 009](ADR%20009%20-%20Deterministic%20naming.md))"; it is structurally unable to name an index called anything else — such as a real database's `identities_user_id_idx`. The contract asserts a named database object exists and cannot tell you its name. That is not a fact about what exists; it is a lossy encoding that discards the object's identity, recoverable only by re-running a naming algorithm that lives outside the contract.

The boolean also contradicts this ADR's own self-containment claim. The decision below states "every FK is self-contained and interpretable without consulting any other part of the contract," yet [§5](#5-deterministic-planner-behavior) makes the index conditional on *the rest of the table* — "emit `CREATE INDEX` … **if no covering index**." So a reader cannot tell from the FK node whether a distinct index exists; they must scan the table's other indexes and apply the covering rule. `index: true` on a FK already backed by an explicit index is the same fact stated twice, reconciled by a rule — not a self-contained value.

This is the contract's *facts, not instructions* principle ([Data Contract subsystem](../subsystems/1.%20Data%20Contract.md), design principle #4): `constraint` and `index` are directives to the planner ("emit this DDL") and verifier ("check for this"), not statements of what exists. The statements of what exist are: this referential constraint, and this named index.

### The corrected model

Emit **materializes** the authoring sugar into discrete entities. A storage foreign-key entity is the referential constraint (source, target, `onDelete`/`onUpdate`) plus a reference to the object that backs it, never a boolean. Every index — including one that happens to back a FK — is a discrete index entry carrying its own name. The `constraint`/`index` knobs survive only as *authoring input* (`foreignKeyDefaults`, per-FK overrides); they are lowered at emit, and the booleans never appear in `contract.json`: `index` lowers to the foreign key's reference to its backing object, or to no reference for `index: false`.

Every environment case the original decision raised is expressed by presence or absence of a discrete entity, which is *more* faithful, not less:

- **Managed services that omit FK constraints but keep the index** (e.g. PlanetScale): the domain relation is present (the ORM still knows the relationship), the storage foreign-key entity is absent (no physical constraint), and the index entity is present. The relation/constraint split already models exactly "a logical relationship with no enforced constraint" — cleaner than `constraint: false`.
- **Intentionally skipping a FK's index**: no index entity for those columns.
- **Postgres not auto-indexing FKs**: the presence or absence of a named index entity *is* the fact — nothing is inferred from a flag.

## A foreign key names its backing index

```prisma
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])

  @@index([authorId], where: "archived_at IS NULL", name: "post_author_live")
}
```

```jsonc
"foreignKeys": [
  { "source": { "columns": ["author_id"] }, "target": { "tableName": "user", "columns": ["id"] },
    "index": { "name": "post_author_id_idx_6c952402" } }
],
"indexes": [
  { "name": "post_author_live_e53b14dd", "columns": ["author_id"], "where": "archived_at IS NULL" },
  { "name": "post_author_id_idx_6c952402", "columns": ["author_id"] }
]
```

The stored foreign key states which object serves its lookups, so a reader of the contract never re-runs a rule to find out. Its `index` field is one of:

- `{ "name": "<stored index name>" }`: an index, identified by its name as [ADR 243](ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md) identifies every index.
- `{ "primaryKey": true }`: the table's primary key. A table has one, so its kind identifies it.
- `{ "unique": true }`: the unique constraint on the foreign key's columns. A unique constraint is identified by its kind and columns, and the columns are the foreign key's own.

The field is absent only when the relation says `index: false`: nothing backs the foreign key. A foreign key whose `index` names nothing on its table, or names an object whose first columns are not the foreign key's columns, is refused by contract validation. A contract written before the field existed (0.15 and earlier) may carry a boolean `index` on a foreign key; the loader treats it as absent.

### How the build chooses it

The authoring surface is unchanged. A relation always gets its own derived backing index unless it says `index: false`. It may instead name the object that serves it with `index: "<name>"`: the `name` or `map` the user wrote, or an index's stored name, of an index, unique constraint or primary key on the same table whose first columns are the foreign key's columns. A name that matches objects of two kinds is refused.

Then one pass removes indexes that duplicate another, for every table, whatever declared them:

- **Identical indexes.** Two indexes are identical when the planner considers their content equal (`SqlIndexIR.contentEquals`: columns in order, expression, predicate, uniqueness, access method and options, with the target's default access method equal to none). The name is not compared. An index is named by the user when its source gave it `name` or `map`; a derived backing index and an unnamed `@@index` are not. Of an identical group the pass keeps the user-named index, or the first one if none is named. Two identical indexes both named with `map:` are both kept, with the warning `PN_INDEX_DUPLICATE`. Two identical indexes both named with `name:` are refused, because their wire names carry the same content hash and the planner pairs renames by that hash.
- **Indexes a key already serves.** A plain index (columns only, no access method, options, predicate or expression) on exactly the columns of the primary key, a unique constraint, or a unique index with no predicate or expression is redundant: the unique object serves every lookup it would. The pass removes it unless the user named it, in which case both are kept, with the warning `PN_INDEX_REDUNDANT`. A partial unique index does not count, because it serves only the rows its predicate selects.

A foreign key whose index the pass removes points at what replaced it. If the user later changes their index so it no longer matches, the derived backing index is no longer removed, and the next `migration plan` creates it. The pass runs inside foreign-key materialization in `@internal/sql-contract`, which the PSL interpreter and the TypeScript builder share. Its warnings go through the build's authoring warning sink, like the build's other warnings.

### Reading a database back

`contract infer` reads indexes with their exact names, so they are named by the user. It asks the same predicate the pass uses whether the relation's derived backing index would be redundant next to the live table's indexes and keys. If it would be, the relation is written with no `index` argument, and emitting the result keeps the live object. Otherwise, when a live key or plain index starts with the foreign key's columns, the relation names it with `index: "<live name>"`; when nothing serves the foreign key, it writes `index: false`. A database read back and emitted plans no change. `contract print` follows the same rule: it writes `index:` only where the stored foreign key differs from what the relation would get without the argument.

### Without a foreign key constraint

A relation with `constraint: false` stores no foreign key entry, so nothing records its backing index. The derived index is still created and still de-duplicated. Nothing reads the link when there is no constraint: the verifier has no constraint to check, and the ORM joins by the relation's fields.

The original per-FK boolean design, its authoring sugar, and its planner/verifier behavior are recorded unchanged below as the superseded approach.

## Context

Prisma Next expresses every schema intent through the data contract. Foreign keys are already modeled in the contract as structural facts — they declare which columns reference which table. However, the control plane today always emits both the FK constraint DDL **and** a supporting index for every declared FK, with no user override.

Different environments demand different FK behavior:

- **Managed services** like PlanetScale omit FK constraints entirely; users still want indexes on FK columns.
- **Performance-sensitive workloads** may intentionally skip FK-supporting indexes when data patterns already cover the access path (e.g., a composite index that starts with the FK columns).
- **PostgreSQL** automatically creates indexes for primary keys and unique constraints, but **not** for foreign keys. Some environments add them, others do not.

Without explicit knobs, the planner either over-emits (wasted DDL) or under-emits (missing constraints/indexes), and the verifier can't distinguish intentional absence from drift.

## Problem

Users need to control whether FK constraints and FK-supporting indexes are emitted in migration DDL, and whether the verifier reports their absence as drift. The behavior must be explicit, deterministic, and visible in the contract without hidden runtime emulation or target-guessing magic.

## Constraints

- **ADR 003 (explicit over implicit):** behavior must be opt-in and visible in the contract.
- **ADR 010 (canonicalization):** per-FK fields are part of storage and affect `storageHash`.
- **ADR 009 (deterministic naming):** FK constraint and generated index names follow deterministic naming rules.
- **ADR 065 / ADR 117 (capability model):** gating uses capability keys, never target-name branching.
- **ADR 038 (idempotency):** FK/index operations must keep explicit pre/post checks and remain replay-safe.
- **Self-contained nodes:** Each object in the contract must be interpretable from its own node without global mode flags.

## Decision

### 1. Per-FK configuration fields

Each `ForeignKey` entry in `storage.tables.*.foreignKeys[]` carries explicit boolean fields:

```ts
type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly constraint: boolean; // Emit ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY
  readonly index: boolean;      // Emit CREATE INDEX for FK columns
};
```

These fields are **required** in the canonical contract JSON — every FK is self-contained and interpretable without consulting any other part of the contract. There is no global mode flag.

### 2. Contract-level defaults (authoring sugar)

The TypeScript contract DSL provides a root `foreignKeyDefaults` option. During lowering, defaults are **materialized** into each FK node:

```ts
const User = model('User', {
  fields: {
    id: field.column(int4Column).id(),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
  },
}).sql(({ cols, constraints }) => ({
  table: 'post',
  foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
}));

const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  foreignKeyDefaults: { constraint: false, index: true }, // PlanetScale-style
  models: { User, Post },
});
```

Per-FK overrides take precedence over defaults:

```ts
constraints.foreignKey(cols.userId, User.refs.id, { constraint: true })
// ^^^ constraint: true overrides the default false
```

### 3. No global config in canonical contract

The emitted `contract.json` contains **no** top-level `foreignKeys` config. All FK behavior is expressed per-node inside `storage.tables.*.foreignKeys[]`.

### 4. Canonicalization and hashing

Per-FK fields live inside `storage.tables`, which is already included in `storageHash` computation. Changing FK fields between contract revisions produces a new hash and a new migration edge.

### 5. Deterministic planner behavior

The planner reads each FK's `constraint` and `index` fields individually:

- `fk.constraint === true` → emit `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`
- `fk.constraint === false` → skip FK constraint DDL for this FK
- `fk.index === true` → emit `CREATE INDEX` for this FK's columns (if no covering index)
- `fk.index === false` → skip FK-backing index for this FK

This enables **mixed configs** within a single contract (e.g., one FK with constraint, another without).

### 6. Schema verification

The verifier reads each FK's fields individually:

- `fk.constraint === true` → missing FK constraint is reported as `foreign_key_mismatch`
- `fk.constraint === false` → FK constraint presence/absence is not verified
- `fk.index === true` → missing FK-backing index is reported as `index_mismatch`
- `fk.index === false` → FK-backing index is not verified

### 7. Normalization

For backward compatibility with older contract.json files, normalization fills missing `constraint` and `index` fields with defaults (`true`).

### 8. Capability keys

| Key | Type | Reported by | Meaning |
|---|---|---|---|
| `sql.foreignKeys` | boolean | adapters that support FK constraints | Database supports `FOREIGN KEY` DDL |
| `sql.autoIndexesForeignKeys` | boolean | adapters where the DB auto-indexes FKs | Database automatically creates indexes for FKs |

Postgres reports `sql.foreignKeys: true` and `sql.autoIndexesForeignKeys: false`.

## Consequences

### Positive

- FK behavior is fully explicit and deterministic per-node.
- Each FK entry is self-contained — no global mode flags.
- Mixed FK configs within a single contract are supported.
- Migration planner output is predictable per-FK.
- Capability gating ensures fail-fast diagnostics for unsupported configurations.

### Negative

- Users must set `constraint: false` for FK-less environments. This is intentional: explicit over implicit.
- Changing FK config requires a new migration (hash changes). This is correct: schema intent changed.
- Every FK entry in the canonical JSON must include `constraint` and `index`, making the JSON slightly more verbose.

## Scope

**v1 (this ADR):**
- Per-FK `constraint` and `index` fields in the contract IR.
- TS contract builder support with `foreignKeyDefaults()` sugar.
- Per-FK planner emission/omission.
- Schema verification per-FK.
- Postgres-first implementation and tests.

**v2 (deferred):**
- Capability-gated behavior (`sql.foreignKeys`, `sql.autoIndexesForeignKeys`). Capability keys are documented in `capabilities.md` but planner enforcement is deferred until a non-Postgres target requires it.

**Out of scope:**
- Runtime emulated referential integrity.
- Cross-target rollout beyond Postgres.
