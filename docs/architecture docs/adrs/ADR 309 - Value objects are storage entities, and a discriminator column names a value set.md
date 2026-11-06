# ADR 309 — Value objects are storage entities, and a discriminator column names a value set

**Status:** Accepted
**Date:** 2026-10-21
**Domain:** Contract, Migration System

## At a glance

A model stores a value object in one column on SQL, and as a subdocument on MongoDB:

```prisma
type Address {
  street String
  city   String
}

model User {
  id      Int      @id
  address Address?
}
```

Every `User` row holds a document such as `{"street": "Main St", "city": "Oslo"}`. Suppose the schema renames `street` to `line1`. The rows still hold `street`, so the application reads `line1` as missing.

The contract has two planes ([ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)). `domain` describes what the application works with. `storage` describes what is stored, and its hash, `storageHash`, is how the migration system tells one database state from another. When `Address` lives in the domain plane, the rename changes nothing in storage, the hash stays the same, and the migration system sees no change.

So `Address` lives in the storage plane, and the domain field refers to it there by coordinate:

```json
{
  "domain": {
    "namespaces": {
      "public": {
        "models": {
          "User": {
            "fields": {
              "address": {
                "nullable": true,
                "type": { "kind": "valueObject", "entityKind": "valueObject", "entityName": "Address", "namespaceId": "public", "plane": "storage" }
              }
            }
          }
        }
      }
    }
  },
  "storage": {
    "namespaces": {
      "public": {
        "entries": {
          "valueObject": {
            "Address": {
              "fields": {
                "city": { "nullable": false, "type": { "codecId": "pg/text@1", "kind": "scalar" } },
                "street": { "nullable": false, "type": { "codecId": "pg/text@1", "kind": "scalar" } }
              }
            }
          }
        }
      }
    }
  }
}
```

Renaming `street` changes the storage entity, so it changes `storageHash`. The planner sees the change the same way it sees a renamed column.

## Decision

1. **A value object is a storage entity.** It lives at `storage.namespaces.<ns>.entries.valueObject.<Name>`, in both families, with the same definition it had in the domain plane: `fields`, each with `nullable`, `type` and, for a list, `many`. A domain field that holds one refers to it by entity coordinate, as a field typed by an enum refers to its value set. A value object field that holds another value object refers to it the same way.
2. **A SQL discriminator column names a value set.** The SQL build writes one value set per base model that has variants, holding each variant's discriminator value as the column stores it, and the base table's discriminator column refers to it, as an enum column refers to its value set ([ADR 157](ADR%20157%20-%20Execution%20enums.md)). MongoDB writes none: its collection validator already pins each variant's discriminator value, so a change to one already changes the storage hash.

Both are enforced where the database can enforce them, as an enum's value set is: on a managed Postgres table the build derives a check for the discriminator column and for a column that holds a value object, and on MongoDB the collection validator lists the value object's fields and the discriminator's values.

## Why

Which plane an entity belongs to depends on what it is used for. The migration planner, the database marker and the saved contract snapshots all work in storage hashes, so a fact the planner must see belongs in storage. A value object's fields are such a fact: they are the keys every row holds in that column, or every subdocument holds in that collection. A discriminator's values are the same kind of fact for its column. The domain plane may refer to the storage plane, never the reverse, so the domain field keeps its reference and storage keeps the definition.

When these facts sit only in the domain plane, a change to them is invisible to the migration system:

- `migration plan` reports no changes.
- A migration from a hash to the same hash is rejected unless it carries a hand-written data operation.
- Snapshots are saved by storage hash, and the first one saved for a hash is kept, so a plan's "previous contract" may be several changes old.

The rows then hold keys and values the contract no longer names, without a word. Refusing a schema change that silently loses data is what the migration system's refusal exists for, and it cannot refuse a change it cannot see.

Storage already holds stored facts the database does not enforce. SQLite derives no check for an enum, yet its value set is in storage, and changing it changes the hash. The MongoDB collection validator lists the fields of embedded value objects. This decision applies the same rule to value objects on SQL and to discriminator values.

## How

**Value objects.** The storage entity keeps the field definition the domain plane used, so every reader of a value object's fields reads the same shape, from the storage plane. Its fields have no stored names of their own: each is stored under its own name, in both families. Scalar members carry their codec and, when an enum types them, a `valueSet` reference to the enum's storage value set, since storage never refers to the domain plane. A member that is a value object refers to its storage entity by coordinate, so a value object that contains itself, such as a `NavItem` whose `children` are `NavItem`s, is one entity that refers to itself. On SQL the column that holds a value object stays a JSON column; on MongoDB the validator is derived from the storage entity, as it is from the definition today.

**Why one definition, not a domain definition and a storage entity.** Models and tables are two definitions: a domain model, a storage table, and the model's `storage` that maps one to the other, so a field can have a stored name different from its own. A value object could follow that pattern, with a domain value object, a storage entity and a mapping between them. It does not, because nothing needs the mapping today: a value object's fields are stored under their own names in both families, so a second definition would hold the same fields and need a check that the two agree. The cost is that a value object field cannot have a stored name of its own without a later change to this shape. Adding one then means a stored-name slot, or a domain definition beside the storage entity, and the hash rules for each.

**Where the principle stops.** "A fact the planner must see belongs in storage" is applied here to value objects and discriminator values. It is not applied to the names of enum members, which decide which member a stored value reads as; they stay in the domain plane. Whether they should move is open in [TML-3720](https://linear.app/prisma-company/issue/TML-3720).

**The framework defines the entity kind.** Families and packs contribute storage entity kinds ([ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)), but the framework defines `valueObject`, because a domain field refers to it and the framework resolves that reference, validates it and types it. Where a value object member names a value set, the framework reads the `valueSet` slot by key, to check that the reference resolves; each family defines the value set entity itself. Both families validate a value object against one schema from the framework: each field has `nullable`, always written; `type`; `many` when it is a list; `dict` only as `true`; and an optional `valueSet` reference. Each family still registers its own descriptor and IR class for the kind.

**Discriminators.** The value set is keyed `<Base>.<discriminator field>`, such as `Task.type`, and holds the values sorted, so the order variants are declared in does not change the hash. A discriminator an enum types keeps the enum's value set and check: the column has one value set reference, and the enum already restricts it. Enum value sets are keyed by the enum's name, so only an enum named exactly like a discriminator's key, in the same storage namespace, clashes with it. No authoring surface writes such a name, since PSL names are identifiers and the SQL TypeScript builder has no polymorphism; the build refuses it all the same, naming both and saying to rename the enum. Enum names are not otherwise restricted. A variant stored in its own table changes nothing here: its rows are still told apart by the base table's column. The ORM writes a row only through a variant, so every row's value names a variant, and the derived check (`"type" IN ('bug', 'feature')`) rejects only a value no variant names, as an enum's check does.

```json
"type": { "codecId": "pg/text@1", "dataType": "pg/text", "nullable": false, "valueSet": { "entityKind": "valueSet", "entityName": "Task.type", "namespaceId": "public", "plane": "storage" } }
```

**Enforcement on Postgres.** On a managed table, a column that holds a value object gets a derived check, as an enum column does, named `<table>_<column>_shape_<hash>`, where `<hash>` is the first eight hexadecimal digits of the hash of the check's expression, such as `user_address_shape_5c02601b`. Its check kind is `shape`: like `membership` and `elementNotNull`, the kind names what the check enforces, here the shape of the column's value. It is one strict `jsonpath` predicate, written so that an unknown result fails, rather than the key-set operators `?&` and `-`:

```sql
jsonb_path_match("address", 'strict $.type() == "object"
  && exists($.keyvalue() ? (@.key == "street" && (@.value.type() == "string")))
  && !exists($.keyvalue() ? (@.key != "street"))') IS TRUE
```

The value must be an object, or for a list an array of objects. Each required member must be present; a nullable member may be absent or JSON `null`; no other key may be. A scalar member must have the JSON type its codec writes, an enum member must hold a value of its value set, and a nested value object is checked the same way, inline. A nullable column also accepts SQL `NULL` and JSON `null`. Members are read through `keyvalue()`, so an absent member is never an error, and strict mode keeps a comparison from unwrapping an array. A value object that contains itself is checked in full down to where it refers back into itself, and any object is accepted below, as the MongoDB validator does. Each PostgreSQL codec declares, on its descriptor, the JSON type its value is written as inside a JSON document: a string, a number, a boolean, an object, an array, or any JSON value, for a JSON codec. The SQL family reads it when it resolves the value object, and the check requires each member to be of that type, so a required member is never JSON `null` unless its codec's type is any JSON value. A `Decimal` member must be a JSON string, as the SQL ORM writes it. The check is opaque and content-named ([ADR 244](ADR%20244%20-%20Check%20constraints%20are%20opaque%20wire-named%20expressions.md)), so any change to the value object changes the check's name, and the diff drops the old check and adds the new one.

**Why a change is normally an operation.** The storage hash identifies a database state. Two different hashes are two different database states, so the migration between them is expected to do something to the database. On a target that derives enforcement, a change to a value object or to the discriminator values is a change to a check or a validator, which is an operation. This holds on Postgres, for its derived checks, and on MongoDB, for its collection validators. It does not hold in every case, and the known cases with no operations are:

- every value object change and every discriminator value change on a target with no check renderer, which today are SQLite and MySQL;
- on Postgres, a change to a member's codec or type parameters that keeps the JSON type the check reads, such as `pg/text@1` to `pg/varchar@1`: the check expression, and so its name, stay the same.

The system handles these rather than refusing them: `migration plan` writes the package with no operations and reports it, naming the storage entities that changed, and `db migrate` applies it by moving the marker to the new hash.

**Who reads them.** The migration planner compares them between the origin and destination contracts, to find renamed and removed value object fields and changed discriminator values, and to order the row rewrite between the old check's drop and the new check's creation, as for an enum value. Type emission and the ORM read value objects from the storage plane through the domain field's reference.

## Consequences

- Any change to a value object, and any change to a variant's discriminator value, changes `storageHash`. On a target that derives enforcement it also changes the enforcing check or validator, except in the cases listed under "Why a change is normally an operation", where the migration has no operations. The planner asks about the ones that lose data and plans their rewrite, as for any other storage change.
- A removed variant that has no columns of its own is visible to the planner through the value set.
- Whether the rows are rewritten, and how efficiently, is a separate decision. This one only makes the change visible.
- `valueObjects` is no longer a domain namespace key. A contract that keeps it there is refused, with a message saying to re-emit it.
- Moving the value objects changes the storage hash of every contract that has them, including a project's committed migration snapshots. The upgrade rewrites the snapshots, renames their directories and updates the migrations that name them; the databases are then signed with the new hashes. On Postgres, the next migration adds the derived checks, and a row that does not fit, such as one whose value object has a key it does not declare, fails it.

## Alternatives considered

- **Keep value objects in the domain plane, because the database schema does not change.** The tables, columns and checks are the same after a value object field rename, so one could hold that the storage hash should not change and the migration system should ignore it. Then the system can never detect the change, even to refuse it, and the old keys stay in every row without a word.
- **Keep them in the domain plane and record such a change as a migration from a hash to itself.** A migration with a hand-written data operation can already do this. But snapshots are saved by storage hash, so a plan's "previous contract" can be several changes old. Fixing that means a different snapshot key, a larger change than this one, and `db update`, which runs no data operations, still could not apply it.
- **Copy the definition into the storage plane and keep the domain copy.** The hash would change, but while value object fields have no stored names the two copies would hold the same fields, and they could drift apart. The domain plane can already refer to storage. See "Why one definition" above for when a second definition would be worth its cost.
- **Feed the domain value objects into the storage hash without moving them.** The hash would change, but the planner compares storage, so it still could not tell what changed, and every reader of the hash would have to know that part of the domain plane feeds it.
- **Record the facts in storage without enforcing them.** The hash would change, but no target would enforce the new facts, not even one that can. What this gives up is enforcement on Postgres and MongoDB: rows the contract no longer describes would stay without a word. Migrations with no operations are not the reason; this decision accepts them on targets that cannot enforce.

## Related

- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md): the planes, coordinates and the direction of references
- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md)
- [ADR 178 — Value objects in the contract](ADR%20178%20-%20Value%20objects%20in%20the%20contract.md): this decision replaces its sections "Value objects are a top-level contract section" and "Value objects need no special storage mapping"
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 157 — Execution enums](ADR%20157%20-%20Execution%20enums.md): value sets
