# ADR 166 — Referential actions for foreign keys

## Context
Foreign keys in the contract IR declare structural relationships between tables (columns → referenced table/columns). ADR 161 added explicit knobs for whether FK constraints and supporting indexes are emitted. However, there is no way to express **referential actions** — the database behavior that fires when a referenced row is deleted or updated (`ON DELETE CASCADE`, `ON UPDATE SET NULL`, etc.).

Without referential actions in the contract, the migration planner omits `ON DELETE` and `ON UPDATE` clauses entirely. The database falls back to the SQL standard default (`NO ACTION`), which means any delete or update that would violate the FK constraint simply fails. Users cannot express intent for CASCADE, SET NULL, or other actions through the contract.

[ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md) (Migration Structure & Operations) anticipates referential action parameters (`onDelete?`, `onUpdate?`) in foreign key check signatures.

## Problem

Users need to declare referential actions per foreign key, and the planner must emit the corresponding DDL clauses. The contract IR, builder, validator, canonicalization, planner, introspection, and verification layers all need coordinated changes.

## Constraints

- **ADR 003 (explicit over implicit):** referential actions must be visible in the contract, not inferred.
- **ADR 010 (canonicalization):** new FK fields participate in the canonical representation and affect `storageHash`.
- **ADR 009 (deterministic naming):** FK naming is unaffected; actions are properties of the constraint, not the name.
- **ADR 161 (FK configuration):** referential actions compose with constraint/index knobs. When `constraints: false`, referential actions have no effect (no constraint DDL is emitted).

## Decision

### 1. Contract IR extension

Add a `ReferentialAction` union and optional `onDelete`/`onUpdate` fields to `ForeignKey`:

```ts
type ReferentialAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

type ForeignKey = {
  readonly columns: readonly string[];
  readonly references: ForeignKeyReferences;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};
```

When omitted, both default to `undefined` — the database applies its default behavior (Postgres: `NO ACTION`).

### 2. Builder API

The `.foreignKey()` method accepts an optional options object as its third parameter. The third parameter was previously `name?: string`; the new signature accepts either a string (backward-compatible name) or an options object:

```ts
.foreignKey(
  ['userId'],
  { table: 'user', columns: ['id'] },
  { name: 'post_userId_fkey', onDelete: 'cascade', onUpdate: 'noAction' }
)
```

### 3. Validator and `fk()` factory

The Arktype `ForeignKeySchema` gains optional `onDelete` and `onUpdate` fields with a literal union constraint. The `fk()` factory accepts an optional fourth parameter that is either a string (name) or an options object with `name?`, `onDelete?`, `onUpdate?`.

### 4. Canonicalization

When `onDelete` or `onUpdate` is `undefined`, or is `noAction`, which the SQL family names as its default, it is not serialized, producing the same canonical output and hash as a FK without referential actions. Explicit values are included in the canonical output.

### 5. DDL emission (Postgres planner)

`buildForeignKeyOperations()` appends referential action clauses after the `REFERENCES` clause:

```sql
ALTER TABLE "public"."post"
ADD CONSTRAINT "post_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "public"."user" ("id")
ON DELETE CASCADE
ON UPDATE NO ACTION
```

Mapping: `noAction` → `NO ACTION`, `restrict` → `RESTRICT`, `cascade` → `CASCADE`, `setNull` → `SET NULL`, `setDefault` → `SET DEFAULT`.

When both `onDelete` and `onUpdate` are `undefined`, no clauses are appended (preserving current behavior).

### 6. Introspection

The Postgres control adapter joins `information_schema.referential_constraints` to read `delete_rule` and `update_rule`, mapping them to camelCase `ReferentialAction` values. The schema IR (`SqlForeignKeyIR`) gains matching optional fields.

### 7. Schema verification

`verifyForeignKeys()` compares `onDelete` and `onUpdate` when present on the contract FK. A mismatch produces a `foreign_key_mismatch` issue. When the contract FK omits referential actions, the verifier does not compare them (undefined means "don't care" for verification purposes).

### 8. Semantic validation

- `setNull` on a non-nullable FK column is rejected at validation time (the database would fail at runtime anyway).
- `setDefault` on a FK column without a declared default is optionally validated (hardening, not blocking).

## Consequences

### Positive

- Users can express referential integrity intent directly in the contract.
- DDL output is deterministic and matches the contract declaration.
- Round-trip fidelity: introspection reads actions from the database, verification compares them against the contract.
- Fully backward-compatible: new fields are optional, existing contracts are unaffected.

### Negative

- Postgres-only in this increment. Other targets (SQLite, SQL Server) require separate implementation.
- No runtime emulation of referential actions when `constraints: false` — actions are DDL-only.

## Scope

**v1 (this ADR):**
- Contract IR, builder, validator, factory, canonicalization.
- Postgres planner DDL emission.
- Postgres introspection and schema verification.
- Semantic validation for `setNull` on non-nullable columns.

**Deferred:**
- SQLite and SQL Server DDL emission (native, no emulation).
- Runtime emulation of referential actions.
- Altering referential actions on existing FKs (`DROP CONSTRAINT` + `ADD CONSTRAINT`).
