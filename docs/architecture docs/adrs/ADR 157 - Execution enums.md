# ADR 157 — Execution enums

**Status: Partially superseded.** The idea stands: an enum is a set of allowed values plus an explicit enforcement mechanism, and execution derives the allowed values from the contract. How the contract realizes it is superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized). The contract has no `storage.sets` and no structured `inSet` checks, and a native enum is not a `storage.types` entry with `typeParams.values`. The sections it replaces carry a note and are kept as a record.

> **Retrospective note — the codec's JSON methods are renamed.** [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md#codecs) replaces `decodeJson` with `fromDataTypeValue`: `db.enums` reads each member's stored value with `fromDataTypeValue`.

We want enum-like behavior that is explicit in storage and reusable in execution.

## Summary

> Superseded in part by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): the portable mechanism is a value set plus a derived check, not ADR 156's sets and `inSet` checks, and execution reads the domain enum (`db.enums`) and, for native enums, the value set (`db.nativeEnums`).

- “Enum” means **a set of allowed values** plus an explicit **storage enforcement mechanism**.
- The execution plane derives “allowed values” from storage enforcement so lanes don’t drift.
- The portable baseline is **sets + check constraints** (ADR 156).
- Targets can also have **native enum types**, as long as they’re explicit in storage (Postgres today).

## Context

> The last paragraph is superseded in part by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): execution reads the domain enum (`db.enums`) and, for native enums, the value set (`db.nativeEnums`).

Developers want to write “this column is an enum with these values” and have three things line up:

- **Storage (database)** enforces the allowed values
- **Execution plane** (query lanes + execution context) understands those allowed values for validation and ergonomics
- **Contract** stays explicit about what the database schema must satisfy

Postgres has native enum types, but not every SQL target does. Even on Postgres, teams sometimes avoid native enums due to operational trade-offs (value removal/reordering, rebuilds, etc.).

So “enum” is not a single portable storage primitive across SQL targets.

This ADR defines what “execution enums” means in Prisma Next: a consistent execution-plane view of “allowed values”, derived from explicit storage enforcement in the contract.

## Prior ADRs

> ADR 156 is superseded. The [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized) says what replaced it.

This ADR builds directly on:

- **ADR 155** — codec/driver boundary value representation: we need deterministic, driver-independent value representations to use in execution and (in some cases) in contracts.
- **ADR 156** — storage sets + check constraints: we need an explicit, portable storage mechanism for “column value is in this set”.

This ADR does not redefine those components; it defines how “enums” are expressed and consumed using them.

## Terminology

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): an enum's members and its value set hold each value in the form the codec stores it, not as a canonical string.

- **set**: a named list of allowed values, stored as canonical strings plus a `codecId` (ADR 156).
- **enforcement mechanism**: the storage rule the database uses to enforce membership (native enum type, check constraint, etc.).
- **execution enum**: the execution-plane behavior: “given a column, what values are allowed?” + “is this value allowed?”.

Note: we call it a “set” because that’s the mental model, but some storage mechanisms treat the list as **ordered** (notably Postgres enums).

## What problem are we solving?

> Superseded in part by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): a native enum is a `native_enum` storage entry, and the portable mechanism is a value set plus a derived check.

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

> The "execution derives from storage" and value-encoding bullets are superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): `db.enums` reads the domain enum, and members are stored in the form the codec stores them.

- **Contract must be explicit**: storage enforcement is described directly in `storage`, not inferred later.
- **Execution derives from storage**: execution-plane “allowed values” are derived from `storage`, not duplicated under `execution`.
- **Deterministic value encoding**: when the contract needs to store a list of allowed values, it stores canonical strings plus a `codecId` (ADR 155, ADR 156).
- **Portable baseline**: we need an emulated strategy that works on targets without native enum types.

## Non-goals

> The second bullet is superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): a native enum now derives a value set, as a domain enum does.

- This ADR does not define the authoring surface (“how users write enums in PSL/TS”). It only defines contract meaning and execution-plane behavior.
- This ADR does not require refactoring native enums to reference `storage.sets` today. It calls that out as future work.

## Decision

### 1) Define “enum” as: set + explicit enforcement mechanism

In Prisma Next, an “enum” is not a single universal storage node. It is:

- **a set** of allowed values (shared definition), and
- **an enforcement mechanism** (how storage enforces membership)

The enforcement mechanism must be explicit in the contract.

### 2) Supported enforcement mechanisms (contract-level)

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): the contract has no `storage.sets`, no `inSet` checks, and no `pg/enum@1` entry in `storage.types`.

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

> The derivation bullets are superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): a column's allowed values come from the value set its `valueSet` reference names.

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

> The execution-plane bullets are superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): execution reads the domain enum (`db.enums`) and, for native enums, the value set (`db.nativeEnums`), and on SQL targets the database enforces membership.

- **Authoring/emission**:
  - users author “enum with values” ergonomically
  - emitters choose an explicit storage strategy and emit the enforcement into `storage` (no target-dependent reinterpretation later)
- **Control plane**:
  - creates/verifies the explicit storage enforcement described by `storage`
- **Execution plane**:
  - derives “allowed values” from `storage`
  - exposes shared helpers so all lanes behave consistently

## Worked examples

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized), which has an example the contract build emits today. The contract shapes below no longer exist.

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

> Superseded in part by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): the storage facts are now the value set, the derived checks and the `native_enum` entry. Each is part of `storage`, so a change to any of them changes `storageHash`.

Enum enforcement and membership lists are **storage facts**:

- changing `storage.sets.*.values`
- changing `checks[]`
- changing native enum `storage.types.*.typeParams.values`

All must be treated as storage changes and should affect `storageHash` (and therefore marker verification expectations).

Execution helpers derived from storage do not need to affect marker verification.

## FAQ

### “Why not store enums only in the model section?”

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized). The domain plane holds the enum, with its names, values and codec, and `db.enums` reads it. Storage holds the value set that columns reference and the derived checks that enforce it.

Because SQL query lanes operate on tables/columns, and the database enforces constraints on tables/columns. Enum behavior needs to be derivable from storage enforcement, not from a model-only view.

### “Why do sets store strings + a codecId?”

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): a member is stored in the form its codec stores it.

Because JSON cannot safely represent many domain values (big numbers, dates, etc.) in a way that round-trips deterministically. ADR 155 standardizes a canonical boundary representation, and ADR 156 uses that representation for set members.

### “Are sets actually sets, or ordered lists?”

> Superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): a value set is an ordered list for both kinds of enum.

They’re “sets” in the sense that they describe membership. But some enforcement mechanisms treat ordering as schema-significant (Postgres enums). If we refactor native enums to reference `storage.sets`, we must treat `storage.sets.*.values` as an ordered canonical list for that use case.

## Amendment (October 7, 2026) — the accessor holds decoded values

`db.enums` holds each member as the value a query returns for it: the enum's codec reads the member's stored form with `decodeJson`, so an int8 member stored as `"1"` is `1n` and a timestamp member is a `Date` or a Temporal value. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member: a primitive by SameValueZero, an object by its kind and the form the codec stores it in.

A client resolves every enum's codec when it builds `db.enums`, so a client refuses a contract whose enum codec its runtime lacks, with `RUNTIME.CODEC_DESCRIPTOR_MISSING`. It decodes an enum's members when the enum is first read, once, so a codec that needs something the runtime lacks, such as a global `Temporal`, fails only when that enum is read. An immutable member is handed out as decoded; a mutable one, such as a `Date`, is copied on every read. The Mongo ORM checks a written enum value against the same accessors.

## Amendment (October 12, 2026) — how enums are realized

The idea of this ADR stands: an enum is a set of allowed values plus an explicit enforcement mechanism. The contract realizes it as follows, and this replaces the sections marked above.

**A domain enum.** PSL writes `enum Name { Member = <value> }` with an optional `@@type("<codec id>")`. Without `@@type`, the codec is inferred from the members: text members take the target's text codec, integer members take its integer codec, and any other members are the error `PSL_ENUM_CANNOT_INFER_TYPE`. TypeScript writes `enumType(name, codec, member(...))`. The contract holds the enum at `domain.namespaces.<ns>.enum.<Name>`, where `<ns>` is the target's default namespace (`public` on Postgres), whatever namespace the model that uses it is in. It holds the `codecId` and the ordered `members`, each a `{ name, value }` pair. The value is in the form the codec stores it, so a `pg/int4@1` member is the number `1` and a `pg/int8@1` member is the string `"1"`.

**A value set.** The contract build also writes `storage.namespaces.<ns>.entries.valueSet.<Name>` in the same namespace: the ordered stored values. Both the SQL and the Mongo family write it. A field typed by the enum carries a `valueSet` reference to the domain enum, and on SQL its column carries a `valueSet` reference to the value set. A reference names the plane, the entity kind, the namespace and the name.

**Why an enum has two representations.** The domain enum is the application's concept: the member names, the values and the codec. The emitted domain types and `db.enums` read it. The value set is its storage projection: the stored values a column references, which a reader of the storage plane can resolve without the domain plane. Both are written from the one declaration. A native enum has no domain enum. Besides its `native_enum` entry, it gets a value set with the same members, because `valueSet` is a core SQL entity kind: the emitter writes value sets into the contract types, where `db.nativeEnums` and the column types read them, and it does not emit pack kinds such as `native_enum`.

**The derived check.** On a `managed` table, the SQL contract build derives a check from the column and the enum's members, and stores it as an opaque wire-named expression ([ADR 244](<./ADR 244 - Check constraints are opaque wire-named expressions.md>)). This ADR calls it the derived check. A scalar column gets `"col" IN (...)`. A list column gets `array_remove("col", NULL) <@ '{...}'`, and a second derived check, `array_position("col", NULL) IS NULL`, when its elements are not nullable. SQLite has no check renderer, so it derives no checks (ADR 244). Mongo enforces membership with the `enum` keyword of the collection's `$jsonSchema` validator.

**A native Postgres enum.** PSL writes a `native_enum` block and types a column `pg.enum(Name)`. TypeScript writes `nativeEnum(name, ...values)`, with `.map(typeName)` for the Postgres type name, and types a column `pg.enum(handle)`:

```ts
import { int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, nativeEnum, pg } from '@internal/postgres/contract-builder';

const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

const contract = defineContract({
  models: {
    Session: model('Session', {
      fields: {
        id: field.column(int4Column).id(),
        aal: field.column(pg.enum(AalLevel)).optional(),
      },
    }).sql({ table: 'sessions' }),
  },
});
```

The contract holds a `native_enum` storage entry keyed by the Postgres type name (`aal_level`), a value set derived from it keyed by the entity name (`AalLevel`), and columns with `dataType: "pg/enum"`, `typeParams.typeName` and a `valueSet` reference to that value set. A native enum has no domain entity. Its domain field has `typeParams.typeName` and no `valueSet` reference, and its emitted type comes from the storage value set. PSL member names such as `OPEN` do not reach the contract: the entry and the value set hold the values only, and `db.nativeEnums` names each member by its value. The database type enforces membership, so no check is derived.

**Execution.** No runtime code reads a column's `valueSet` reference. The client exposes accessors. `db.enums` holds each domain enum, built from the domain plane, with members decoded as the October 7 amendment describes. On Postgres it is `db.enums.<ns>.<Name>`; SQLite and Mongo expose `db.enums.<Name>`, from the unbound namespace. On Postgres, `db.nativeEnums.<ns>.<Name>` holds the native enums: the namespace's value sets, minus each one a domain enum names. On SQL targets the database enforces membership, through the derived check or the native type, and query lanes do not check it. The Mongo ORM checks a written value against `db.enums`. The emitted types narrow a field's read and write types to the members.

**Which codecs can type an enum.** A codec without the `equality` trait, or one that sets `enumRefusal`, cannot type an enum ([ADR 254](<./ADR 254 - Data types and casts.md>), amendment of October 7, 2026). On a `managed` table of a target that derives checks (Postgres today), each member of an enum column must be stored as a string or a finite number. Both refusals are `CONTRACT.ENUM_INVALID`.

**Example.** This schema declares one domain enum and one native enum:

```prisma
native_enum TicketStatus {
  OPEN   = "open"
  CLOSED = "closed"
  @@map("ticket_status")
}

enum Priority {
  @@type("pg/int8@1")
  Low  = "1"
  High = "10"
}

model Ticket {
  id       Int                     @id
  status   pg.enum(TicketStatus)
  priority Priority

  @@map("tickets")
}
```

The domain plane holds the domain enum and the field that references it:

```json
{
  "domain": {
    "namespaces": {
      "public": {
        "enum": {
          "Priority": {
            "codecId": "pg/int8@1",
            "members": [
              { "name": "Low", "value": "1" },
              { "name": "High", "value": "10" }
            ]
          }
        },
        "models": {
          "Ticket": {
            "fields": {
              "priority": {
                "nullable": false,
                "type": { "codecId": "pg/int8@1", "kind": "scalar" },
                "valueSet": { "entityKind": "enum", "entityName": "Priority", "namespaceId": "public", "plane": "domain" }
              },
              "status": {
                "nullable": false,
                "type": { "codecId": "pg/enum@1", "kind": "scalar", "typeParams": { "typeName": "ticket_status" } }
              }
            }
          }
        }
      }
    }
  }
}
```

The storage plane holds the native type, both value sets, the columns and the derived check:

```json
{
  "storage": {
    "namespaces": {
      "public": {
        "entries": {
          "native_enum": {
            "ticket_status": { "kind": "postgres-enum", "members": ["open", "closed"], "typeName": "ticket_status" }
          },
          "table": {
            "tickets": {
              "checks": [
                { "expression": "\"priority\" IN ('1', '10')", "name": "tickets_priority_check_8f50aef7", "prefix": "tickets_priority_check" }
              ],
              "columns": {
                "priority": {
                  "codecId": "pg/int8@1",
                  "dataType": "pg/int8",
                  "nullable": false,
                  "valueSet": { "entityKind": "valueSet", "entityName": "Priority", "namespaceId": "public", "plane": "storage" }
                },
                "status": {
                  "codecId": "pg/enum@1",
                  "dataType": "pg/enum",
                  "nullable": false,
                  "typeParams": { "typeName": "ticket_status" },
                  "valueSet": { "entityKind": "valueSet", "entityName": "TicketStatus", "namespaceId": "public", "plane": "storage" }
                }
              }
            }
          },
          "valueSet": {
            "Priority": { "kind": "valueSet", "values": ["1", "10"] },
            "TicketStatus": { "kind": "valueSet", "values": ["open", "closed"] }
          }
        }
      }
    }
  }
}
```

The emitted row type has `priority: 1n | 10n` and `status: 'open' | 'closed'`.

## Consequences

> The "portable baseline" benefit and the first cost are superseded by the [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized): the portable mechanism is a value set plus a derived check, and execution reads the domain enum (`db.enums`) and, for native enums, the value set (`db.nativeEnums`).

### Benefits

- **Explicit contracts**: no target-dependent reinterpretation of “enum”.
- **Portable baseline**: check constraints + sets provide an explicit, cross-target strategy.
- **Shared behavior**: enum validation and “allowed values” UX is one implementation, reused across lanes.

### Costs

- We need execution-plane helpers that resolve enforcement → allowed values reliably.
- Some targets have caveats around check constraints; capabilities must be honest about enforcement support.

## Related

> ADR 156 is superseded. The [October 12, 2026 amendment](#amendment-october-12-2026--how-enums-are-realized) says what replaced it.

- ADR 155 — Driver/Codec boundary value representation and responsibilities
- ADR 156 — Storage sets and check constraints
- [ADR 244 — Check constraints are opaque wire-named expressions](<./ADR 244 - Check constraints are opaque wire-named expressions.md>)
- [ADR 254 — Data types and casts](<./ADR 254 - Data types and casts.md>)
