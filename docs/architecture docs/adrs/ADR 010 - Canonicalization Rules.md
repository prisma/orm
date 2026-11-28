# ADR 010 — Canonicalization Rules for contract.json

**Status:** Accepted
**Domain:** Contract & Schema

## At a glance

A contract's storage hash is the SHA-256 of a text built from three things: the contract's `target`, its family (`targetFamily`) and its `storage` section. This record says how that text is built.

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

The SQL family left out each column's `"many": false`, because the family defines an absent `many` to mean the same. It kept `"fastupdate": false`, because that value belongs to the GIN index type and the family does not know what it means. It also kept `"unique": false`, `"uniques": []` and `"foreignKeys": []`, which it does not name as defaults. The framework then sorted every key and printed the result with a two-space indent and no trailing newline.

## Decision

Turning a section into the text that is hashed has two owners.

- **Each family owns the normal form of its own content.** A family supplies one function, `normalizeStorage`. It leaves out the fields that the family defines as defaults, orders the lists whose order means nothing to the database, and keeps everything else as given.
- **The framework sorts and encodes.** It does not know what any field means and reorders no list.

The family's function is applied to `storage` both when a contract is written and whenever a storage hash is computed or checked. So `contract.json` holds the normal form, and the hash covers what the written `storage` holds. Two fields in the written `storage` are not hashed: the section's own `storageHash`, and each namespace's `kind` ("The whole computation" says why).

Which sections each hash covers, and the rule that none of this changes within a major version, are in [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md). This record says how a section becomes the text that is hashed and the file that is written.

## Why

Prisma records the hashes in a project's files and in its databases. It compares them to decide whether a database matches a contract, and whether two migrations connect: a migration names the storage hashes it starts and ends at, and one follows another when it starts at the hash the other ends at. Three properties follow.

- **The same contract must always give the same text.** A contract written in TypeScript and the same contract written in the Prisma schema language must hash the same, on any machine. That needs a fixed key order, a fixed encoding, and one form for every default.
- **Two contracts that mean different things must never give the same text.**
- **A written contract must keep every value its author wrote whose absence would mean something else.**

The hard part is defaults, because a value's shape does not say whether it is one. `false` on a column's `many` means "not a list", which is also what an absent `many` means. `false` inside a PostgreSQL index's options, as in `{ "fastupdate": false }`, is a setting the user chose, and an absent `fastupdate` means the server's default, `true`. A rule that left out every `false` and every empty value would get the second case wrong:

- the index's options would be written as `{}`, so the user's setting would be lost from the file and from the hash;
- a MongoDB partial filter `{ "isAdmin": false }` would become a filter that matches every document;
- two types whose parameters differ only by such a value would share a storage hash.

Only the family knows that an absent `many` means `false`. So a family leaves out a field only where the family has said that leaving the field out means the same as the value, and it lists each such field. Prisma's two families list theirs in this record, under "What a family does".

Some data in `storage` is owned by someone other than the family: a codec owns a column type's parameters, and a target or an extension owns an index type's options. The family carries that data without knowing what it means, so it keeps that data exactly as given. The user chooses how to write it, and two ways of writing the same setting, such as no options and `{ "fastupdate": true }`, give two storage hashes. That is accepted, because it never makes two different contracts share a hash. Its cost falls on a user who switches between the two forms: the switch is planned as a migration that changes no setting. The worst case is an index whose name is derived from its content ([ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)), where that migration renames or rebuilds the index.

## The rules

### The whole computation

To compute a storage hash:

1. Take the `storage` section, and remove its `storageHash`: a hash cannot cover itself.
2. Remove each namespace's `kind`, such as `postgres-schema`. The serializer writes it into the file from the target and the namespace's `id`, which are both in the hash input already. The storage the family's authoring code builds, where a hash is first computed, holds it only as a non-enumerable field, which is not serialized.
3. Apply the family's `normalizeStorage`. When the contract is written, the function receives each namespace's `kind`; when a hash is computed, it does not. So the function must not depend on `kind`, or writing and hashing would disagree. Neither of Prisma's families reads it.
4. Put the result beside the contract's top-level `target` and `targetFamily`: `{ storage, target, targetFamily }`.
5. Sort every key, as below.
6. Print it with `JSON.stringify(value, null, 2)`.
7. Take the SHA-256 of that text as UTF-8, in lowercase hexadecimal.

The profile hash follows steps 4 to 7 with `capabilities` in place of `storage`. The execution hash does the same with `execution`, after removing the section's own `executionHash` as in step 1 ([ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md)).

### What the framework does

1. **Keys.** Every object's keys are sorted by UTF-16 code unit, at every depth, with one exception:
   - Keys that are array indexes come first, in ascending numeric order, because that is how JavaScript orders an object's keys.
   - An array index is a non-negative integer below 2³² − 1 written in its shortest form, such as `"0"` or `"10"`; `"01"` is not one and sorts as a string.
   - For example, `{ "b": 1, "10": 2, "2": 3, "a": 4 }` is printed with its keys in the order `"2"`, `"10"`, `"a"`, `"b"`. A table named `2024`, or a column named `1`, has such a key.

   The same order applies wherever this record says keys are sorted, in the written files too.
2. **Arrays.** Every array keeps the order it is given in.
3. **Encoding.**
   - The result is printed by `JSON.stringify` with a two-space indent. The indent is part of the rule: the same JSON printed without it has a different hash.
   - Numbers, booleans, `null` and string escapes are as `JSON.stringify` prints them.
   - A key whose value is `undefined` is left out, as `JSON.stringify` leaves it out.
   - An implementation in another language must print exactly what `JSON.stringify` prints. It checks that by computing the hashes of the saved contracts in each family's `hash-rules.fixed-answers.test.ts` ([ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md)) and comparing them with the literals there.
4. **Hash.** SHA-256 of that text as UTF-8, written as lowercase hexadecimal with no prefix. The hash does not record which rules produced it: there is only one set of rules within a major version (ADR 332).

A hash is computed from parsed sections, never from the bytes of a file. To check a stored contract, Prisma parses the file and follows the steps above.

### What a family does

Terms used in this section:

- The kinds of entry are `table`, `collection`, `valueObject`, `valueSet`, and kinds a target or an extension pack adds. (This "kind of entry" is unrelated to a namespace's `kind` field.)
- A value object is a structured type stored inside a row or document; a value set is a named list of allowed values, such as an enum's.
- A column or a value object's field may carry `typeParams`, the parameters of its type, such as a `varchar`'s length. A field whose type is a union carries them on each member of the union.
- `storage.types` holds named column types that columns refer to.

A family's normal form does two things to `storage`. The SQL family's list below also drops one obsolete flag, which is not a default.

**It leaves out the family's own defaults.** Each family decides its own; the SQL family keeps an index's `unique: false`, for example, where the MongoDB family leaves it out.

The SQL family leaves out:

- `many: false` on a column or on a value object's field;
- an empty `typeParams` on a column, on a value object field's type, on a member of that type's union, or on an entry of `storage.types`;
- a table's empty `checks`;
- an index's empty `columns` and empty `options`;
- a foreign key's `onDelete` or `onUpdate` of `noAction`;
- an empty map of entries of any kind other than `table`;
- a foreign key's `index` when it is `true` or `false`. This is not a default but an obsolete flag: releases of Prisma 8's predecessor project, published as the `@prisma-next/*` packages, wrote it before their version 0.16, and the family reads it as absent. An `index` object, which describes the index, is kept.

The MongoDB family leaves out:

- a collection's empty `indexes`;
- an index's `unique` or `sparse` of `false`;
- a collation's `caseLevel` or `numericOrdering` of `false`;
- an empty `required` or `properties` keyword anywhere in a collection validator's `jsonSchema`, including its sub-schemas. A field that happens to be named `required` or `properties`, inside a `properties` map, is a field, not a keyword, and is kept;
- `many: false` on a value object's field;
- an empty `typeParams` on a value object field's type or on a member of that type's union;
- an empty map of entries of any kind other than `collection`.

`nullable` is always written ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). A MongoDB collation's `backwards` and `normalization` are always kept, because the server's default for them depends on the locale.

**It orders the lists whose order means nothing to the database.** These are a SQL table's `checks`, `foreignKeys`, `indexes` and `uniques`, and a MongoDB collection's `indexes`. Both families order them the same way, after leaving out their defaults:

1. By `name`, compared by UTF-16 code unit. An entry with no name counts as the empty string, so unnamed entries come first.
2. Entries with the same name, or with none, by their content: each entry printed as compact JSON with its keys sorted as in the framework's key rule, compared by UTF-16 code unit.

For example, indexes listed as `[{ "name": "b_idx", … }, { "columns": ["x"] }, { "name": "a_idx", … }]` are hashed as the unnamed one, then `a_idx`, then `b_idx`. So reordering these lists in the contract source changes no hash. Lists whose order has meaning keep it: the columns of a composite key, the keys of a MongoDB index, the members of a value set. A table's columns are an object keyed by name, so the file records no column order and the hash covers none.

**Everything else is kept exactly as given.** That includes the contents of data a family carries without owning: a type's parameters, an index's options, a MongoDB partial filter expression, a generator's parameters, the members of a value set, and every field of an entry that a target or an extension pack defines. A `false`, `[]` or `{}` inside any of these stays. The family owns the containers that hold this data, though, so it may leave out an empty container as a whole: it does so for an empty `typeParams` and an empty SQL index `options`.

**The function.** A family supplies it as `normalizeStorage` on its contract serializer (`ContractSerializer.normalizeStorage`). It:

- has the type `(storage: unknown) => unknown`;
- must not change its input;
- must give the same result when applied to its own output, because it runs when the contract is written and again on the parsed file whenever the hash is checked. Leaving out a field that is already absent, and sorting a list already in order, change nothing.

A target's serializer uses its family's function; PostgreSQL's has a test that it does.

A family built outside this repository names its defaults in its own documentation, orders its unordered lists (the order above is a good choice) and keeps that order for the major version, and holds its output fixed with the test described in ADR 332.

Two sections outside `storage` follow the same idea:

- A family leaves its own defaults out of the `domain` section when it writes it, for example a model field's `many: false`. `domain` is in no hash.
- The framework code that builds the capability list, before the contract is hashed, leaves out a capability flag that is off, so `capabilities` holds only flags that are on. This is a rule of how the list is built, not of the encoding.

### What an author of an entry kind does

Only a family names defaults. So the author of an entry kind, in a target or an extension pack, gives each of its fields one form: either the field is required, or the entry's constructor always writes the default out, or the constructor always leaves the field out when its value is the default. Otherwise the same value written out and left out would be one meaning with two storage hashes, and that could not be corrected within a major version.

For example, suppose an extension defines a `searchIndex` entry with a `language` field that defaults to `"english"`. Its constructor writes `language: "english"` when the contract gives no language, so every `searchIndex` without one has the same storage.

### The written files

Prisma writes a contract in two forms. The bytes of neither file are hashed; a hash is always computed from the sections, never from a file's bytes.

- **The emitted `contract.json`:**
  - is printed with a two-space indent and no trailing newline;
  - has its top-level keys in a fixed order that puts the format version, the family, the target and the profile hash first; the storage and execution hashes are keys inside their own sections;
  - has every key below the top level sorted, except inside the `_generated` notice that the emitter appends at the end.

  The order is `TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`. A new top-level section is added both there and to the sections `canonicalizeContractToObject` writes, in the same file.
- **A snapshot's copy**, under `migrations/snapshots/<storage hash>/`, is compact JSON with every key sorted and a trailing newline.

The top-level `meta` section is for tooling. It does not change what a contract means and is in no hash.

### Who computes and who checks

- The family's authoring code computes the storage hash when it builds the contract. A test fixture may write the hash by hand instead of computing it.
- The emitter writes the hash, and refuses to write a `storage` section that does not hash to it.
- A reader of a snapshot hashes the stored `storage` again and refuses it when the result differs from the hash in its directory name.
- An extension package that ships its own migrations also ships the contract they end at, and names that contract's hash in its head ref. Prisma hashes that contract again when it loads the extension and refuses a mismatch.

Every function that computes or checks a storage hash takes the family's `normalizeStorage` as a required argument. The family's own code imports it, and the CLI takes it from the target's contract serializer. The profile and execution hashes do not cover `storage`, so they take no such function.

## Consequences

- A contract written in TypeScript and the same contract written in the Prisma schema language give the same file and the same hashes.
- A family that does not name one of its defaults keeps that field as given. That is harmless to the hash only if the family's authoring code always writes the field the same way; if it sometimes writes the default out and sometimes leaves it out, one meaning gets two hashes. The opposite mistake, leaving out a value that is not a default, is the one that makes two contracts share a hash, and it is possible only through a rule a family writes on purpose.
- An author of a type, an extension pack or a target can rely on Prisma to keep a `false`, `[]` or `{}` that appears inside the data they own.
- The rules, including each family's normal form, do not change within a major version (ADR 332): for the same `storage`, the normal form gives the same output in every release. A family may reorganize its normal form's code, but it must give the same output. So a family cannot start leaving out a field that existing contracts already write: those contracts would get a new hash. A field added for a new feature may have its default left out from the start.
- Each family's test, `hash-rules.fixed-answers.test.ts`, holds saved contracts to literal hashes. Among them are two contracts that differ only in that one has every named default written out and every list the family sorts in an unsorted order, and the other has the defaults left out and the lists sorted. Both must give the same storage hash.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, and let each family list the paths where they are kept.** Rejected, for the reasons under "Why": the framework cannot know which values are defaults, and every path left off the list loses a value from the file and the hash.
- **Require that `false` and empty always mean absent inside data a family does not own.** Rejected. It puts a convention nothing checks on authors outside this repository, and a violation gives two different contracts one hash.
- **Hand the framework content that each family has already normalized, with no function.** Rejected. A storage hash is also computed where no written file exists and checked against files read back, and every such place would have to remember to normalize first. With one required function, writing and hashing use the same normal form.
- **Compact JSON, with no whitespace, as the hash input.** Rejected. Either encoding would serve; the indented one prints like `contract.json`, which is easier to compare by eye when a hash differs. Changing it now would change every hash, which cannot happen within a major version.
- **Strict RFC 8785 (JSON Canonicalization Scheme) as the encoding.** Rejected. It would serve as well as the encoding chosen, but it differs from it: it prints with no whitespace and orders keys without putting array-index keys first. Adopting it would change every hash, which cannot happen within a major version. Defaults and list order would still be the family's job.
- **A binary canonical format such as Protobuf or CBOR.** Rejected. A contract is read and reviewed by people and by tools that expect JSON.
- **Keep the order of a table's indexes, uniques, foreign keys and checks in the hash.** Rejected. Reordering two relations in a model reorders their foreign keys, which would change the storage hash and ask for a migration that does nothing.
