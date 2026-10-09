# ADR 157 — Execution enums

We want enum-like behavior that is explicit in storage and reusable in execution.

## Summary

- “Enum” means **a set of allowed values** plus an explicit **storage enforcement mechanism**.
- The execution plane derives “allowed values” from storage enforcement so lanes don’t drift.
- The portable baseline is **sets + check constraints** (ADR 156).
- Targets can also have **native enum types**, as long as they’re explicit in storage (Postgres today).

## Context

Developers want to write “this column is an enum with these values” and have three things line up:

- **Storage (database)** enforces the allowed values
- **Execution plane** (query lanes + execution context) understands those allowed values for validation and ergonomics
- **Contract** stays explicit about what the database schema must satisfy

Postgres has native enum types, but not every SQL target does. Even on Postgres, teams sometimes avoid native enums due to operational trade-offs (value removal/reordering, rebuilds, etc.).

So “enum” is not a single portable storage primitive across SQL targets.

This ADR defines what “execution enums” means in Prisma Next: a consistent execution-plane view of “allowed values”, derived from explicit storage enforcement in the contract.

## Prior ADRs

This ADR builds directly on:

- **ADR 155** — codec/driver boundary value representation: we need deterministic, driver-independent value representations to use in execution and (in some cases) in contracts.
- **ADR 156** — storage sets + check constraints: we need an explicit, portable storage mechanism for “column value is in this set”.

This ADR does not redefine those components; it defines how “enums” are expressed and consumed using them.

## Terminology

- **set**: a named list of allowed values, stored as canonical strings plus a `codecId` (ADR 156).
- **enforcement mechanism**: the storage rule the database uses to enforce membership (native enum type, check constraint, etc.).
- **execution enum**: the execution-plane behavior: “given a column, what values are allowed?” + “is this value allowed?”.

Note: we call it a “set” because that’s the mental model, but some storage mechanisms treat the list as **ordered** (notably Postgres enums).

## What problem are we solving?

The primary problem is: **how do we provide enum behavior on databases that don’t have a native enum representation?**

Postgres native enums can be implemented as a target-owned storage type with a dedicated codec (`pg/enum@1`) and control-plane hooks. That approach doesn’t generalize to targets that simply don’t have “enum types” as a storage primitive, and we don’t want to force the contract to pretend that they do.

So we need a portable mechanism that:

- expresses the allowed values explicitly in the contract
- provides a storage enforcement strategy we can apply across targets (ADR 156’s sets + `inSet` checks)
- gives the execution plane one shared way to discover/validate “allowed values”, without making each lane reinvent enum logic

If we don’t do this, two secondary problems show up quickly.

First, we end up with an ambiguous contract:

> The contract says “enum”, but the system chooses how to enforce it (native type vs check constraint) based on the target at runtime.

That undermines schema verification and makes diffs less meaningful: the same JSON could imply different database schemas depending on where it’s executed.

Second, we get lane drift:

> Each query lane invents its own enum validation and “allowed values” UX.

We want one implementation shared via the execution context, derived from the contract, so behavior is consistent across lanes.

## Design constraints

- **Contract must be explicit**: storage enforcement is described directly in `storage`, not inferred later.
- **Execution derives from storage**: execution-plane “allowed values” are derived from `storage`, not duplicated under `execution`.
- **Deterministic value encoding**: when the contract needs to store a list of allowed values, it stores canonical strings plus a `codecId` (ADR 155, ADR 156).
- **Portable baseline**: we need an emulated strategy that works on targets without native enum types.

## Non-goals

- This ADR does not define the authoring surface (“how users write enums in PSL/TS”). It only defines contract meaning and execution-plane behavior.
- This ADR does not require refactoring native enums to reference `storage.sets` today. It calls that out as future work.

## Decision

### 1) Define “enum” as: set + explicit enforcement mechanism

In Prisma Next, an “enum” is not a single universal storage node. It is:

- **a set** of allowed values (shared definition), and
- **an enforcement mechanism** (how storage enforces membership)

The enforcement mechanism must be explicit in the contract.

### 2) Supported enforcement mechanisms (contract-level)

#### A) Check constraint (“emulated enum”, portable baseline)

Use ADR 156:

- `storage.sets[SetName]` defines the allowed values
- `storage.tables[table].checks[]` includes `{ kind: "inSet", column, setRef }`

This is the portable baseline across SQL targets.

#### B) Native enum type (Postgres today)

Postgres native enums exist today as:

- a parameterized `storage.types[TypeName]` entry for `pg/enum@1`
- enum values stored inline as `storage.types[TypeName].typeParams.values: string[]` (ordered)
- columns reference the type via `column.typeRef`

This mechanism is already explicit: the database enforcement is “the column has a native enum type”.

#### Note: possible refactor (native enums referencing `storage.sets`)

ADR 156 includes a note about a possible future refactor: native enums could reference `storage.sets` via a `setRef` so there is one source of truth for the value list.

That is not the current implementation; this ADR treats it as future work, not a requirement.

### 3) Execution-plane behavior: “allowed values” are derived and shared

The execution plane must expose a shared, lane-agnostic way to:

- **discover** the allowed values for a storage column, and
- **validate** a JS/domain value against those allowed values

Lanes should not carry their own enum logic. They should call a helper on the execution context (or a thin library used by the execution context).

At a conceptual level, derivation looks like this:

- if there is an `inSet` check for `(table, column)`, resolve `setRef` → `storage.sets[setRef]`
- if the column is a native enum type, resolve `column.typeRef` → `storage.types[typeRef].typeParams.values`
- use the relevant `codecId` to translate JS/domain values ⇄ canonical strings for membership testing (ADR 155)

The important part is *where this logic lives*: it should be implemented once (execution context / shared execution helper), then reused by all lanes.

## Where logic lives

- **Authoring/emission**:
  - users author “enum with values” ergonomically
  - emitters choose an explicit storage strategy and emit the enforcement into `storage` (no target-dependent reinterpretation later)
- **Control plane**:
  - creates/verifies the explicit storage enforcement described by `storage`
- **Execution plane**:
  - derives “allowed values” from `storage`
  - exposes shared helpers so all lanes behave consistently

## Worked examples

### Example 1: Emulated enum via check constraint (portable)

#### Contract (simplified)

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
          "status": { "codecId": "pg/text@1", "dataType": "pg/text", "nullable": false }
        },
        "checks": [{ "kind": "inSet", "column": "status", "setRef": "UserStatus" }],
        "uniques": [],
        "indexes": [],
        "foreignKeys": []
      }
    }
  }
}
```

Note: this example uses Postgres codec IDs for concreteness. The same shape applies on other targets, with target-appropriate `codecId` / `dataType`.

#### Control plane implications

- creates a check constraint for `user.status` that enforces membership in `UserStatus`
- uses the canonical string values from the set when generating DDL (with dialect-specific casts/quoting)

#### Execution plane implications

- allowed values for `user.status` are discovered by following `checks[].setRef`
- a lane validating `{ status: "active" }` compares the canonical string encoding of the JS value against the set members

### Example 2: Native Postgres enum type (current implementation)

#### Contract (simplified)

```json
{
  "storage": {
    "types": {
      "Role": {
        "codecId": "pg/enum@1",
        "dataType": "pg/enum",
        "typeParams": { "values": ["USER", "ADMIN"] }
      }
    },
    "tables": {
      "user": {
        "columns": {
          "role": {
            "codecId": "pg/enum@1",
            "dataType": "pg/enum",
            "typeRef": "Role",
            "nullable": false
          }
        },
        "uniques": [],
        "indexes": [],
        "foreignKeys": []
      }
    }
  }
}
```

#### Control plane implications

- verifies/creates the native enum type `role` with values `["USER", "ADMIN"]`
- verifies that `user.role` uses that native type

#### Execution plane implications

- allowed values for `user.role` are discovered by resolving `column.typeRef` → `storage.types.Role.typeParams.values`
- lanes can treat those values as the allowed set for validation and UX

## Hashing implications

Enum enforcement and membership lists are **storage facts**:

- changing `storage.sets.*.values`
- changing `checks[]`
- changing native enum `storage.types.*.typeParams.values`

All must be treated as storage changes and should affect `storageHash` (and therefore marker verification expectations).

Execution helpers derived from storage do not need to affect marker verification.

## FAQ

### “Why not store enums only in the model section?”

Because SQL query lanes operate on tables/columns, and the database enforces constraints on tables/columns. Enum behavior needs to be derivable from storage enforcement, not from a model-only view.

### “Why do sets store strings + a codecId?”

Because JSON cannot safely represent many domain values (big numbers, dates, etc.) in a way that round-trips deterministically. ADR 155 standardizes a canonical boundary representation, and ADR 156 uses that representation for set members.

### “Are sets actually sets, or ordered lists?”

They’re “sets” in the sense that they describe membership. But some enforcement mechanisms treat ordering as schema-significant (Postgres enums). If we refactor native enums to reference `storage.sets`, we must treat `storage.sets.*.values` as an ordered canonical list for that use case.

## Amendment (October 7, 2026) — the accessor holds decoded values

`db.enums` holds each member as the value a query returns for it: the enum's codec reads the member's stored form with `decodeJson`, so an int8 member stored as `"1"` is `1n` and a timestamp member is a `Date` or a Temporal value. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member: a primitive by SameValueZero, an object by its kind and the form the codec stores it in.

A client resolves every enum's codec when it builds `db.enums`, so a client refuses a contract whose enum codec its runtime lacks, with `RUNTIME.CODEC_DESCRIPTOR_MISSING`. It decodes an enum's members when the enum is first read, once, so a codec that needs something the runtime lacks, such as a global `Temporal`, fails only when that enum is read. An immutable member is handed out as decoded; a mutable one, such as a `Date`, is copied on every read. The Mongo ORM checks a written enum value against the same accessors.

## Consequences

### Benefits

- **Explicit contracts**: no target-dependent reinterpretation of “enum”.
- **Portable baseline**: check constraints + sets provide an explicit, cross-target strategy.
- **Shared behavior**: enum validation and “allowed values” UX is one implementation, reused across lanes.

### Costs

- We need execution-plane helpers that resolve enforcement → allowed values reliably.
- Some targets have caveats around check constraints; capabilities must be honest about enforcement support.

## Related

- ADR 155 — Driver/Codec boundary value representation and responsibilities
- ADR 156 — Storage sets and check constraints

