# ADR 156 — Storage sets and check constraints

**Status: Partially superseded.** Section 2 below — `tables.*.checks[]` as a structured `{ kind: "inSet", column, setRef }` entry, and the statement that this is "intentionally not a general-purpose SQL expression system in the contract" — is superseded by [ADR 244 — Check constraints are opaque wire-named expressions](<./ADR 244 - Check constraints are opaque wire-named expressions.md>). A check now carries one opaque SQL predicate under a content-addressed wire name, because the structured shape could not survive Postgres reprinting the predicates it was supposed to recognise. Section 1 — `storage.sets` and the `column.valueSet` that references it — **remains in force**; value sets still drive generated types, ordering, and developer-facing tooling. They simply no longer travel into the check node, so the `setRef` link described below is gone: a check's members are baked into its predicate text. The examples in section 2 and the check-constraint half of "How this is used" are preserved as a historical record.

## Context

We want to express “this column can only contain one of these values” in a way that is:

- explicit in the contract (no target-dependent reinterpretation later)
- portable across SQL targets (even when a target has no native enum type)
- usable by both the control plane (DDL + verification) and the execution plane (validation + ergonomics)

This shows up most often as “enums”, but the underlying storage primitive is more general: **a set of allowed values** plus **an enforcement mechanism**.

This ADR defines the storage-side building blocks:

- `storage.sets`: named sets of allowed values
- `tables.*.checks[]`: explicit check constraints that can reference a set (starting with an `IN`-set constraint)

Enum authoring UX and enum-as-a-feature remain a separate discussion (see ADR 157).

## Problem

Without an explicit representation, we risk a contract that says “enum” and then lets the system choose a storage strategy later (native enum vs check constraint vs lookup table) based on target support. That makes the contract ambiguous and undermines schema verification.

We also cannot store set members as native JS values in `contract.json`:

- numbers lose precision and formatting
- dates are not representable as stable JSON scalars
- big numbers and other non-primitive domain values have no stable JSON representation

So we need a contract encoding that is deterministic and does not depend on runtime JS value shapes.

## Decision

### 1) Add `storage.sets`

Introduce a new core storage concept:

- `storage.sets` (name): a registry of named sets of allowed values.

Each set stores:

- `codecId`: the codec that defines the canonical string representation for members of this set
- `values: string[]`: members stored as **canonical boundary-encoded strings**

The key rule is: **set members are always stored as canonical strings**, not JS values.

This aligns with ADR 155, which standardizes codec↔driver boundary values and requires a deterministic canonical text form.

### 2) Add `tables.*.checks[]` with a minimal “in-set” check

Add an explicit representation for table check constraints, starting with a structured constraint we can implement and verify deterministically:

- `kind: "inSet"`
- `column`: the constrained column name
- `setRef`: reference to `storage.sets[setRef]`

This is intentionally not a general-purpose SQL expression system in the contract. It’s the smallest shape needed to express “column value is in this named set”.

## Examples (simplified)

### A) Set + check constraint enforcement

```json
{
  "storage": {
    "sets": {
      "UserStatus": {
        "codecId": "pg/text@1",
        "values": ["active", "suspended"]
      }
    },
    "tables": {
      "user": {
        "columns": {
          "status": {
            "codecId": "pg/text@1",
            "dataType": "pg/text",
            "nullable": false
          }
        },
        "checks": [
          { "kind": "inSet", "column": "status", "setRef": "UserStatus" }
        ],
        "uniques": [],
        "indexes": [],
        "foreignKeys": []
      }
    }
  }
}
```

## How this is used

### Control plane (DDL + verification)

- creates the enforcement mechanism described by the contract:
  - emits check constraints when `checks[]` is present
- uses `storage.sets[setRef].values[]` as the canonical value list
- applies dialect-specific literal/cast rules when generating DDL

### Execution plane (validation + ergonomics)

- derives “allowed values for (table, column)” by following storage enforcement references:
  - `checks[].setRef`
- uses the referenced `codecId` to translate JS/domain values ⇄ canonical strings for:
  - validating inputs
  - showing allowed values in developer-facing errors / tooling

## Hashing implications

`storage.sets` and `checks[]` are storage facts the database must satisfy.

Under the `storageHash` / `executionHash` model (see ADR 158):

- changing `storage.sets.*.values` is a **storage change** and must change `storageHash`
- changes to execution-only helpers derived from storage do not need to affect marker verification

## Consequences

### Benefits

- Contract stays explicit: enforcement is described directly, not inferred from target support.
- Deterministic representation: canonical strings avoid JSON/JS pitfalls for numbers/dates.
- One source of truth: enables sharing the same value list across multiple enforcement strategies.

### Costs

- We introduce new storage concepts (`storage.sets`, `checks[]`) that core schema IR and tooling must support.
- DDL emission must handle dialect-specific casting/quoting for check constraint literals (bounded scope, but real work).

## Note: possible refactor for native enums

This ADR is intentionally about **sets + check constraints**.

Today, native Postgres enums are represented as parameterized `storage.types` entries where the enum values live inline (e.g. `storage.types.Role.typeParams.values`).

It may be worth refactoring native enums to reference `storage.sets` via a `setRef` so that:

- there is one source of truth for the value list (usable by both native enums and check constraints), and
- the execution plane can derive allowed values through a single “follow enforcement → set” path.

If we do this, `storage.sets.*.values` should be treated as an **ordered** canonical list (because Postgres enum order is schema-significant).

## Related

- ADR 155 — Driver/Codec boundary value representation and responsibilities
- ADR 157 — Execution enums

