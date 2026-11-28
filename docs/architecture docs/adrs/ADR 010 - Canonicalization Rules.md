# ADR 010 — Canonicalization Rules for contract.json

**Status:** Accepted
**Domain:** Contract & Schema

## At a glance

**The decision: each database family puts its part of a contract into one normal form, leaving out only the defaults it names, and the framework only sorts and encodes the result.** A contract's storage hash is the SHA-256 of a text built from three things: the contract's `target`, its family (`targetFamily`) and its `storage` section. This record says how that text is built, and who owns each step.

In `storage`, each namespace (a PostgreSQL schema, for example) has an `entries` object keyed by the kind of entry, such as `table`, and each kind holds its entries by name. Take this `storage` of a PostgreSQL contract, as the SQL family's authoring code builds it, before it adds the storage hash and writes the contract:

```json
{
  "namespaces": {
    "public": {
      "id": "public",
      "entries": {
        "table": {
          "post": {
            "columns": {
              "id": { "dataType": "pg/int4", "codecId": "pg/int4@1", "nullable": false, "many": false },
              "title": { "dataType": "pg/text", "codecId": "pg/text@1", "nullable": false, "many": false }
            },
            "uniques": [],
            "indexes": [
              {
                "name": "post_title_gin",
                "columns": ["title"],
                "unique": false,
                "type": "gin",
                "options": { "fastupdate": false }
              }
            ],
            "foreignKeys": [],
            "primaryKey": { "columns": ["id"] }
          }
        }
      }
    }
  }
}
```

The text that is hashed:

```json
{
  "storage": {
    "namespaces": {
      "public": {
        "entries": {
          "table": {
            "post": {
              "columns": {
                "id": {
                  "codecId": "pg/int4@1",
                  "dataType": "pg/int4",
                  "nullable": false
                },
                "title": {
                  "codecId": "pg/text@1",
                  "dataType": "pg/text",
                  "nullable": false
                }
              },
              "foreignKeys": [],
              "indexes": [
                {
                  "columns": [
                    "title"
                  ],
                  "name": "post_title_gin",
                  "options": {
                    "fastupdate": false
                  },
                  "type": "gin",
                  "unique": false
                }
              ],
              "primaryKey": {
                "columns": [
                  "id"
                ]
              },
              "uniques": []
            }
          }
        },
        "id": "public"
      }
    }
  },
  "target": "postgres",
  "targetFamily": "sql"
}
```

Its SHA-256, the storage hash, is `3ef79977a23b8d2e85d96a9cea92d84254c32dab74f1bc282daa13a5affb050d`.

Two owners turned the first into the second:

- **The SQL family put `storage` into its normal form.** It left out each column's `"many": false`, because the family defines an absent `many` to mean the same. It kept `"fastupdate": false`: that value belongs to the GIN index type, and the family does not know what it means. It also kept `"unique": false`, `"uniques": []` and `"foreignKeys": []`, which it does not name as defaults.
- **The framework sorted every key and printed the result** with a two-space indent and no trailing newline.

## Decision

**A family owns the normal form of its own content; the framework only sorts and encodes.**

- Each family supplies one function, `normalizeStorage`. It leaves out the fields the family defines as defaults, orders the lists whose order means nothing to the database, and keeps everything else as given.
- The framework does not know what any field means. It reorders no list and leaves out no value, apart from each namespace's `kind` (below).
- The family's function is applied both when a contract is written and whenever its storage hash is computed or checked. So `contract.json` holds the normal form, and the hash covers what the written `storage` holds.

Which sections each hash covers, and the rule that none of this changes within a major version, are in [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md).

## Why

The same contract must always give the same text, whether it was written in TypeScript or in the Prisma schema language, on any machine. And two contracts that mean different things must never give the same text. Both depend on getting defaults right, and a value's shape does not say whether it is a default.

`false` on a column's `many` means "not a list", which is also what an absent `many` means: leaving it out loses nothing. `false` in a PostgreSQL index's options, as in `{ "fastupdate": false }`, is a setting the user chose; an absent `fastupdate` means the server's default, `true`. A rule that left out every `false` and empty value, without knowing which is which, gets the second case wrong:

- the index's options are written as `{}`, so the user's setting is lost from the file and the database;
- a MongoDB partial filter `{ "isAdmin": false }` becomes `{}`, a filter that matches every document;
- two column types whose parameters differ only by such a value share a storage hash.

Only the family knows what its own absent fields mean, so only the family leaves fields out, and it names each one. Data the family carries but does not own, such as a column type's parameters (a codec's) or an index type's options (a target's or an extension's), is kept exactly as written. The cost of that is accepted: two ways of writing the same setting there, such as no options and `{ "fastupdate": true }`, give two storage hashes, so a user who switches between them gets a migration that changes no setting. For an index whose name is derived from its content ([ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)), that migration renames or rebuilds the index. It never makes two different contracts share a hash.

## The computation

To compute a storage hash:

1. Take the `storage` section and remove its `storageHash`, since a hash cannot cover itself.
2. Remove each namespace's `kind`, such as `postgres-schema`. The file holds it, but the target and the namespace's `id`, which are both in the hash input, already decide it.
3. Apply the family's `normalizeStorage`.
4. Put the result beside the contract's `target` and `targetFamily`: `{ storage, target, targetFamily }`.
5. Sort every key by UTF-16 code unit, at every depth. Keys that are array indexes (a non-negative integer below 2³² − 1 in its shortest form, such as `"10"` but not `"01"`) come first, in numeric order, as JavaScript orders them: `{ "b": 1, "10": 2, "2": 3 }` prints as `"2"`, `"10"`, `"b"`. Arrays keep their order.
6. Print it with `JSON.stringify(value, null, 2)`. The indent is part of the rule.
7. Take the SHA-256 of that text as UTF-8, in lowercase hexadecimal.

The profile hash follows steps 4 to 7 with `capabilities` in place of `storage`, leaving out each capability flag that is off; the execution hash does the same with `execution`, after removing its own `executionHash`. A hash is always computed from the sections, never from a file's bytes.

`normalizeStorage` receives each namespace's `kind` when the contract is written, and not when the hash is computed, so it must not depend on `kind`. It must not change its input, and applying it to its own output must change nothing, because it runs again on the parsed file whenever the hash is checked. A target uses its family's function.

## What each family leaves out

Each family names its defaults here. In `storage`, a namespace holds its entries by kind (`table`, `collection`, `valueObject`, `valueSet` and kinds a target or extension adds); a value object is a structured type stored inside a row or document; a value set is a named list of allowed values, such as an enum's; `typeParams` are a type's parameters, such as a `varchar`'s length; `storage.types` holds named column types.

| SQL family | MongoDB family |
| --- | --- |
| `many: false` on a column or a value object's field | `many: false` on a value object's field |
| An empty `typeParams` on a column, a value object field's type or one member of its union, or an entry of `storage.types` | An empty `typeParams` on a value object field's type or one member of its union |
| A table's empty `checks`; an index's empty `columns` or empty `options` | A collection's empty `indexes`; an index's `unique` or `sparse` of `false` |
| A foreign key's `onDelete` or `onUpdate` of `noAction` | A collation's `caseLevel` or `numericOrdering` of `false` |
| An empty map of entries of any kind other than `table` | An empty map of entries of any kind other than `collection` |
| A foreign key's obsolete `index` flag, `true` or `false`, which releases of Prisma 8's predecessor project wrote and the family reads as absent | An empty `required` or `properties` keyword anywhere in a collection validator's `jsonSchema`, including its sub-schemas; a field of that name inside `properties` is kept |

`nullable` is always written. A MongoDB collation's `backwards` and `normalization` are always kept, because the server's default for them depends on the locale.

Each family also sorts the lists whose order means nothing: a SQL table's `checks`, `foreignKeys`, `indexes` and `uniques`, and a MongoDB collection's `indexes`. They are sorted after the defaults are left out, by `name` (an entry with none counts as the empty string), then by content printed as compact JSON with sorted keys. So `[{ "name": "b_idx" }, { "columns": ["x"] }, { "name": "a_idx" }]` is hashed as the unnamed index, then `a_idx`, then `b_idx`. Lists whose order has meaning keep it: a composite key's columns, a MongoDB index's keys, a value set's members.

A family built outside this repository names its defaults in its own documentation, sorts its unordered lists and keeps that order for the major version, and holds its output fixed with the test in ADR 332. A target or extension that defines an entry kind does not name defaults: it gives each field one form, so that the field is required, or its constructor always writes the default, or always leaves the field out when it holds the default.

## The written files

- **`contract.json`** is printed with a two-space indent and no trailing newline. Its top-level keys come in a fixed order, starting with the format version, the family, the target and the profile hash (`TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`; a new top-level section is added both there and to the sections `canonicalizeContractToObject` writes, in the same file, or it is left out of the file). Every key below the top level is sorted, apart from the `_generated` notice the emitter appends.
- **A snapshot's copy** under `migrations/snapshots/<storage hash>/` is compact JSON with every key sorted and a trailing newline.

Neither file's bytes are hashed. The top-level `meta` section is for tooling and is in no hash.

## Who computes and who checks

- The family's authoring code computes the storage hash when it builds the contract.
- The emitter writes it, and refuses to write a `storage` that does not hash to it. That catches a normal form whose second application changes its first result, and a hash computed some other way.
- Reading a snapshot, and loading an extension that ships its own migrations, hash the stored `storage` again and refuse a mismatch with the hash it is stored under.

Every function that computes or checks a storage hash takes the family's `normalizeStorage` as a required argument.

## Consequences

- A contract written in TypeScript and the same contract written in the Prisma schema language give the same file and the same hashes.
- A family that does not name one of its defaults keeps that field as given. That is safe only if its authoring code always writes the field the same way; written out in one contract and left out in another, one meaning gets two hashes.
- Leaving out a value that is not a default is the mistake that makes two contracts share a hash, and it is possible only through a rule a family writes on purpose.
- The normal form is part of the rules ADR 332 freezes. A family may reorganize its code, but for the same `storage` it must give the same output, so it cannot start leaving out a field existing contracts already write. A field added for a new feature may have its default left out from the start. Each family's `hash-rules.fixed-answers.test.ts` holds a contract with every named default written out and every sorted list out of order, and one with them left out and in order, to the same hash.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, and let each family list the paths where they are kept.** Rejected for the reasons under "Why": the framework cannot know which values are defaults, and every path left off the list loses a value from the file and the hash.
- **Require that `false` and empty always mean absent inside data a family does not own.** Rejected: a convention nothing checks, put on authors outside this repository, where a violation gives two different contracts one hash.
- **Hand the framework content each family has already normalized, with no function.** Rejected: a storage hash is also computed where no written file exists and checked against files read back, and every such place would have to remember to normalize first.
- **Compact JSON, or RFC 8785 (JSON Canonicalization Scheme), as the encoding.** Rejected: either would serve, but both print with no whitespace, and RFC 8785 does not put array-index keys first, so adopting either now would change every hash. Defaults and list order would still be the family's job.
- **A binary canonical format such as Protobuf or CBOR.** Rejected: a contract is read and reviewed by people and by tools that expect JSON.
- **Keep the order of a table's indexes, uniques, foreign keys and checks in the hash.** Rejected: reordering two relations in a model reorders their foreign keys, which would change the storage hash and ask for a migration that does nothing.
