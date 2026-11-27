# ADR 010 — Canonicalization Rules for contract.json

**Status:** Accepted
**Domain:** Contract & Schema

## At a glance

A contract's storage hash is the SHA-256 of a text built from three things: the target, the family and the `storage` section. Two owners build that text. The family puts `storage` into its normal form, and the framework sorts the keys and prints the result.

Take this `storage`, as the SQL family's authoring code hands it over for a PostgreSQL contract:

```json
{
  "namespaces": {
    "public": {
      "id": "public",
      "kind": "postgres-schema",
      "entries": {
        "table": {
          "post": {
            "columns": {
              "id": { "dataType": "pg/int4", "codecId": "pg/int4@1", "nullable": false, "many": false },
              "title": { "dataType": "pg/text", "codecId": "pg/text@1", "nullable": false }
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

Three things happened. The SQL family left out the column's `"many": false`, because the family defines an absent `many` to mean the same. It kept `"fastupdate": false` in the index's options, because that value belongs to the index type and the family does not know what it means. The framework removed the namespace's `kind`, sorted every key, and printed the result with a two-space indent. The text has no trailing newline.

## Decision

Canonicalization is split between two owners.

- **The framework sorts and encodes.** It does not know what any field means. It reorders no list, and it leaves out no value, with the two exceptions below.
- **Each family owns the normal form of its own content.** A family supplies one function, `normalizeStorage`, which leaves out the fields that family defines as defaults and orders the lists whose order means nothing to the database.

The framework applies the family's function to `storage` both when it writes a contract and when it computes or checks a storage hash. A value is therefore in the hash input exactly when it is in the written `storage`, with two exceptions that hold in every family: the section's own `storageHash`, and each namespace's `kind` ([ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md)). Both are written in the file and are not hashed.

Which sections each hash covers, and the rule that none of this changes within a major version, are in ADR 332. This record says how a section becomes the text that is hashed and the file that is written.

## Why

Prisma records the hashes in a project's files and in its databases, and compares them to decide whether a database matches a contract and whether two migrations connect. Two properties follow.

- **The same contract must always give the same text.** A contract written in TypeScript and the same contract written in the Prisma schema language must hash the same, on any machine. That needs a fixed key order, a fixed encoding and one form for every default.
- **Two contracts that require different databases must never give the same text,** and a written contract must hold every value its author wrote whose absence would mean something else.

A value's shape does not say whether it is a default. `false` on a column's `many` means "not a list", which is also what an absent `many` means. `false` inside a PostgreSQL index's options, as in `{ "fastupdate": false }`, is a setting the user chose. Only the family knows the first, and only the user knows the second. So a value may be left out only by the owner who knows that the absent field and the value mean the same, and that owner names the field.

## The rules

### What the framework does

- **Keys.** Every object's keys are sorted by UTF-16 code unit, at every depth.
- **Arrays.** Every array keeps the order it is given in.
- **The two fields it removes.** Before hashing `storage`, each caller removes the section's `storageHash`, and the framework removes each namespace's `kind`. `computeStorageHash` takes the storage without its `storageHash`.
- **Encoding.** The result is printed by `JSON.stringify` with a two-space indent. Numbers, booleans, `null` and string escapes are as `JSON.stringify` prints them. The indent is part of the rule: the same JSON printed without it has a different hash.
- **Hash.** SHA-256 of that text as UTF-8, written as lowercase hexadecimal with no prefix. Nothing in a hash names the rules that produced it; [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) gives the same reasoning for wire names.

A hash is computed from parsed sections, never from the bytes of a file. A check of a stored contract parses the file, removes `storage.storageHash`, and hashes the section again.

### What a family does

In `storage`, each namespace has an `entries` object keyed by the kind of entry (`table`, `collection`, `valueObject`, `valueSet`, and kinds a target or an extension pack adds), and each kind holds its entries by name. A value object is a structured type stored inside a row or document; a value set is a named list of allowed values, such as an enum's.

A family's normal form does two things to `storage`.

**It leaves out the family's own defaults.** A family leaves out a field only where the family itself defines the absent field and the value to mean the same, and it names each such field.

| Family | Left out |
| --- | --- |
| SQL | `many: false` on a column or on a value object's field; a table's empty `checks`; an index's empty `columns` or empty `options`; a foreign key's `index` of `true` or `false` (a flag the family reads as absent; an `index` object is kept), and its `onDelete` or `onUpdate` of `noAction`; an empty `typeParams` on a column, on a value object field's type, on a member of its union type, or on an entry of `storage.types`; an empty map of entries of a kind other than `table` |
| MongoDB | a collection's empty `indexes`; an index's `unique` or `sparse` of `false`; a collation's `caseLevel` or `numericOrdering` of `false`; an empty `required` or `properties` anywhere in a collection validator's `jsonSchema`, including its sub-schemas; `many: false` on a value object's field; an empty `typeParams` on a value object field's type or on a member of its union type; an empty map of entries of a kind other than `collection` |

`nullable` is always written ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). A MongoDB collation's `backwards` and `normalization` are always kept, because the server's default for them depends on the locale.

**It orders the lists whose order means nothing to the database.** The SQL family orders a table's `checks`, `foreignKeys`, `indexes` and `uniques`; the MongoDB family orders a collection's `indexes`. Both order them the same way: by `name`, compared by UTF-16 code unit, with a missing name read as the empty string, so unnamed entries come first; entries with equal names are then ordered by their content, printed as compact JSON with sorted keys and compared the same way. Reordering these lists in the contract source changes no hash. Lists whose order has meaning keep it: the columns of a composite key, the keys of a MongoDB index, the members of a value set.

**Everything else is kept exactly as given.** That includes the contents of data a family carries without owning: a type's parameters, an index's options, a MongoDB partial filter expression, a generator's parameters, the members of a value set, and every field of an entry that a target or an extension pack defines. A `false`, `[]` or `{}` inside any of these stays. Only the empty containers the table names, an empty `typeParams` and an empty index `options`, are left out as a whole.

A family supplies the function as `normalizeStorage` on its contract serializer (`ContractSerializer.normalizeStorage`). A target's serializer inherits it from its family's and does not replace it.

Two sections outside `storage` follow the same idea. A family leaves its own defaults out of the `domain` section when it writes it, for example a model field's `many: false`; `domain` is in no hash. A capability flag that is off is left out by the code that builds the capability list, so `capabilities` holds only flags that are on.

### What an author of an entry kind does

Only a family names defaults. So the author of an entry kind, in a target or an extension pack, gives each of its fields one form: the field is required, or its constructor stores the default in one way only. Otherwise a value written out and the same value left out are one meaning with two storage hashes, and that cannot be corrected within a major version.

### The written files

Prisma writes a contract in two forms. Neither is a hash input.

- **The emitted `contract.json`** is printed with a two-space indent and no trailing newline. Its top-level keys are in a fixed order that puts the format version, the family, the target and the profile hash first; the storage and execution hashes are keys inside their own sections. Every key below the top level is sorted. The emitter then appends a `_generated` notice, whose keys are not sorted. The order is `TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`; a new top-level section is added both there and to the sections `canonicalizeContractToObject` writes, in the same file.
- **A snapshot's copy**, under `migrations/snapshots/<storage hash>/`, is compact JSON with every key sorted and a trailing newline.

`meta` is for tooling. It does not change what a contract means and is in no hash.

### Who computes and who checks

- The family's authoring code computes the storage hash when it builds the contract. A test fixture may state the hash instead.
- The emitter writes it, and refuses to write a `storage` section that does not hash to it.
- A reader of a snapshot, and the check of the contract an extension package ships, hash the stored `storage` again and refuse a mismatch.

Every function that computes or checks a storage hash takes the normal form as a required argument, and Prisma passes the family's function, from the target's contract serializer, at each of these places. The framework cannot tell which function it is given. A family that has nothing to normalise passes a function that returns the storage unchanged; the profile and execution hashes are computed that way.

## Consequences

- A contract written in TypeScript and the same contract written in the Prisma schema language give the same file and the same hashes.
- A family that forgets to name a default writes the default into every contract. That is visible in the file and in review, and it is harmless to the hash as long as the family always writes it. The opposite mistake, leaving out a value that is not a default, is the one that makes two contracts share a hash, and it is possible only through a rule a family writes on purpose.
- An author of a type, an extension pack or a target can rely on Prisma to keep a `false`, `[]` or `{}` that appears inside the data they own.
- The rules, and each family's output for a given contract, do not change within a major version (ADR 332). A family may reorganise its normal form's code, but it must give the same output. Each family's test, `hash-rules.fixed-answers.test.ts`, holds saved contracts to literal hashes through `assertContractHashes`. They include a pair that differ only in having every named default written out or left out, and every ordered list out of order or in order, held to one hash. A family or target built outside this repository runs the same helper on its own saved contracts.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, and let each family list the paths where they are kept.** Rejected. The framework cannot know which of those values are defaults, so every value that is not one would have to be found and listed. Where the list is incomplete, the value is lost from the file and from the hash: an index's options `{ "fastupdate": false }` would be written as `{}`, a MongoDB partial filter `{ "isAdmin": false }` would become a filter that matches every document, and two types whose parameters differ only by such a value would share a storage hash.
- **Require that `false` and empty always mean absent inside data a family does not own.** Rejected. It puts a convention nothing checks on authors outside this repository, and a violation gives two different contracts one hash.
- **Hand the framework content that each family has already normalised, with no function.** Rejected. A storage hash is also computed where no written file exists and checked against files read back, and every such place would have to remember to normalise first. With one required function, writing and hashing use the same normal form.
- **Compact JSON, with no whitespace, as the hash input.** Rejected. Either encoding would serve. The indented form is the one the hashes are computed with, and changing it would change every hash, which cannot happen within a major version.
- **Strict RFC 8785 (JSON Canonicalization Scheme).** Rejected. It fixes the encoding but says nothing about defaults or list order, which are where two forms of one contract come from.
- **A binary canonical format such as Protobuf or CBOR.** Rejected. A contract is read and reviewed by people and by tools that expect JSON.
- **Leave the order of the lists a family orders in the hash.** Rejected. Reordering two relations in a model would change the storage hash and ask for a migration that does nothing.
