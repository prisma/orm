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

The SQL family left out the column's `"many": false`, because the family defines an absent `many` to mean the same. It kept `"fastupdate": false`, because that value belongs to the GIN index type and the family does not know what it means. It also kept `"unique": false`, `"uniques": []` and `"foreignKeys": []`, which it does not name as defaults. The framework then removed the namespace's `kind`, sorted every key, and printed the result with a two-space indent and no trailing newline.

## Decision

Turning a section into the text that is hashed has two owners.

- **Each family owns the normal form of its own content.** A family supplies one function, `normalizeStorage`. It leaves out the fields that the family defines as defaults, and it orders the lists whose order means nothing to the database. Everything else it keeps as given.
- **The framework sorts and encodes.** It does not know what any field means. It reorders no list and leaves out no value, with one exception: each namespace's `kind`.

The family's function is applied to `storage` both when a contract is written and whenever a storage hash is computed or checked. So a value is in the hash exactly when it is in the written `storage`, except for two fields that every family writes and no hash covers:

- the section's own `storageHash`, which the caller removes before hashing, since a hash cannot cover itself;
- each namespace's `kind`, which the framework removes. It names the target's kind of namespace, such as `postgres-schema`, which the target and the namespace's `id`, both in the hash input, already determine.

Which sections each hash covers, and the rule that none of this changes within a major version, are in [ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md). This record says how a section becomes the text that is hashed and the file that is written.

## Why

Prisma records the hashes in a project's files and in its databases, and compares them to decide whether a database matches a contract and whether two migrations connect. Two properties follow.

- **The same contract must always give the same text.** A contract written in TypeScript and the same contract written in the Prisma schema language must hash the same, on any machine. That needs a fixed key order, a fixed encoding, and one form for every default.
- **Two contracts that mean different things must never give the same text.**
- **A written contract must keep every value its author wrote whose absence would mean something else.**

The hard part is defaults, because a value's shape does not say whether it is one. `false` on a column's `many` means "not a list", which is also what an absent `many` means. `false` inside a PostgreSQL index's options, as in `{ "fastupdate": false }`, is a setting the user chose, and an absent `fastupdate` means the server's default, `true`. A rule that left out every `false` and every empty value would get the second case wrong:

- the index's options would be written as `{}`, so the user's setting would be lost from the file and from the hash;
- a MongoDB partial filter `{ "isAdmin": false }` would become a filter that matches every document;
- two types whose parameters differ only by such a value would share a storage hash.

Only the family knows that an absent `many` means `false`. Only whoever defines an index type's options knows what `fastupdate: false` means. So a value may be left out only by the owner who knows that the absent field and the value mean the same. A family is that owner for its own fields, and names each one it leaves out. Whoever defines other data, such as an index type's options, is not asked to name defaults: Prisma keeps their data exactly as given, and they give each field one form (see "What an author of an entry kind does").

## The rules

### The whole computation

To compute a storage hash:

1. Take the parsed `storage` section, and remove its `storageHash`.
2. Apply the family's `normalizeStorage`.
3. Remove each namespace's `kind`.
4. Put it beside the contract's top-level `target` and `targetFamily`: `{ storage, target, targetFamily }`.
5. Sort every key, as below.
6. Print it with `JSON.stringify(value, null, 2)`.
7. Take the SHA-256 of that text as UTF-8, in lowercase hexadecimal.

The profile and execution hashes follow the same steps with the `capabilities` or `execution` section in place of `storage`, and without steps 1 to 3 ([ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md)).

### What the framework does

1. **Keys.** Every object's keys are sorted by UTF-16 code unit, at every depth, with one exception:
   - Keys that are array indexes come first, in ascending numeric order, because that is how JavaScript orders an object's keys. An array index is a non-negative integer below 2³² − 1 written in its shortest form, such as `"0"` or `"10"`; `"01"` is not one and sorts as a string.
   - So `{ "b": 1, "10": 2, "2": 3, "a": 4 }` is printed with its keys in the order `"2"`, `"10"`, `"a"`, `"b"`.
   - A table named `2024`, or a column named `1`, has such a key.
2. **Arrays.** Every array keeps the order it is given in.
3. **Namespace kinds.** Each namespace's `kind` is removed. `computeStorageHash` takes `storage` without its `storageHash`.
4. **Encoding.** The result is printed by `JSON.stringify` with a two-space indent. Numbers, booleans, `null` and string escapes are as `JSON.stringify` prints them, and a key whose value is `undefined` is left out, as `JSON.stringify` leaves it out. The indent is part of the rule: the same JSON printed without it has a different hash. An implementation in another language must print exactly what `JSON.stringify` prints; the fixed-answers test in ADR 332 is how it checks that.
5. **Hash.** SHA-256 of that text as UTF-8, written as lowercase hexadecimal with no prefix. The hash does not record which rules produced it: there is only one set of rules within a major version (ADR 332).

A hash is computed from parsed sections, never from the bytes of a file. To check a stored contract, Prisma parses the file, removes `storage.storageHash`, and hashes the section again.

### What a family does

The kinds of entry are `table`, `collection`, `valueObject`, `valueSet`, and kinds a target or an extension pack adds. A value object is a structured type stored inside a row or document; a value set is a named list of allowed values, such as an enum's. A column or a value object's field may carry `typeParams`, the parameters of its type, such as a `varchar`'s length; a field whose type is a union of value objects carries them on each member. `storage.types` holds named column types that columns refer to.

A family's normal form does two things to `storage`.

**It leaves out the family's own defaults.** A family leaves out a field only where the family itself defines the absent field and the value to mean the same, and it names each such field here.

The SQL family leaves out:

- `many: false` on a column or on a value object's field;
- an empty `typeParams` on a column, on a value object field's type, on a member of that type's union, or on an entry of `storage.types`;
- a table's empty `checks`;
- an index's empty `columns` and empty `options`;
- a foreign key's `index` when it is `true` or `false`, a flag that Prisma 8 pre-releases before `0.16` wrote and that the family reads as absent (an `index` object, which describes the index, is kept);
- a foreign key's `onDelete` or `onUpdate` of `noAction`;
- an empty map of entries of any kind other than `table`.

The MongoDB family leaves out:

- a collection's empty `indexes`;
- an index's `unique` or `sparse` of `false`;
- a collation's `caseLevel` or `numericOrdering` of `false`;
- an empty `required` or `properties` anywhere in a collection validator's `jsonSchema`, including its sub-schemas;
- `many: false` on a value object's field;
- an empty `typeParams` on a value object field's type or on a member of that type's union;
- an empty map of entries of any kind other than `collection`.

`nullable` is always written ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). A MongoDB collation's `backwards` and `normalization` are always kept, because the server's default for them depends on the locale.

**It orders the lists whose order means nothing to the database.** These are a SQL table's `checks`, `foreignKeys`, `indexes` and `uniques`, and a MongoDB collection's `indexes`. Both families order them the same way, after leaving out their defaults:

1. By `name`, compared by UTF-16 code unit. An entry with no name counts as the empty string, so unnamed entries come first.
2. Entries with the same name, or with none, by their content: each entry printed as compact JSON with its keys sorted as in the framework's key rule, compared by UTF-16 code unit.

For example, indexes listed as `[{ "name": "b_idx", … }, { "columns": ["x"] }, { "name": "a_idx", … }]` are hashed as the unnamed one, then `a_idx`, then `b_idx`. So reordering these lists in the contract source changes no hash. Lists whose order has meaning keep it: the columns of a composite key, the keys of a MongoDB index, the members of a value set. A table's columns are an object keyed by name, so the file records no column order and the hash covers none.

**Everything else is kept exactly as given.** That includes the contents of data a family carries without owning: a type's parameters, an index's options, a MongoDB partial filter expression, a generator's parameters, the members of a value set, and every field of an entry that a target or an extension pack defines. A `false`, `[]` or `{}` inside any of these stays. Of that data, only an empty `typeParams` and an empty SQL index `options` are left out, and then as a whole.

**The function.** A family supplies it as `normalizeStorage` on its contract serializer (`ContractSerializer.normalizeStorage`). It:

- has the type `(storage: unknown) => unknown`;
- must not change its input;
- must give the same result when applied to its own output, because it runs when the contract is written and again on the parsed file whenever the hash is checked.

A target's serializer uses its family's function; PostgreSQL's has a test that it does.

A family built outside this repository follows the same rules: it names its defaults in its own documentation, orders its unordered lists the same way, and holds its output fixed with the test described in ADR 332.

Two sections outside `storage` follow the same idea. A family leaves its own defaults out of the `domain` section when it writes it, for example a model field's `many: false`; `domain` is in no hash. A capability flag that is off is left out by the code that builds the capability list, so `capabilities` holds only flags that are on.

### What an author of an entry kind does

Only a family names defaults. So the author of an entry kind, in a target or an extension pack, gives each of its fields one form: either the field is required, or its constructor always writes the default out, or its constructor always leaves the field out when its value is the default. Otherwise the same value written out and left out would be one meaning with two storage hashes, and that could not be corrected within a major version.

For example, suppose an extension defines a `searchIndex` entry with a `language` field that defaults to `"english"`. Its constructor writes `language: "english"` when the author gives none, so every `searchIndex` without a language has the same storage.

### The written files

Prisma writes a contract in two forms. Neither is a hash input.

- **The emitted `contract.json`:**
  - is printed with a two-space indent and no trailing newline;
  - has its top-level keys in a fixed order that puts the format version, the family, the target and the profile hash first; the storage and execution hashes are keys inside their own sections;
  - has every key below the top level sorted;
  - ends with a `_generated` notice that the emitter appends, whose keys are not sorted.

  The order is `TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`. A new top-level section is added both there and to the sections `canonicalizeContractToObject` writes, in the same file.
- **A snapshot's copy**, under `migrations/snapshots/<storage hash>/`, is compact JSON with every key sorted and a trailing newline.

The top-level `meta` section is for tooling. It does not change what a contract means and is in no hash.

### Who computes and who checks

- The family's authoring code computes the storage hash when it builds the contract. A test fixture may state the hash instead.
- The emitter writes it, and refuses to write a `storage` section that does not hash to it.
- A reader of a snapshot hashes the stored `storage` again and refuses a mismatch with the hash in its directory name. An extension package that ships its own migrations ships a contract too, and Prisma checks it the same way against the extension's head ref when it loads the extension.

Every function that computes or checks a storage hash takes the family's `normalizeStorage` function as a required argument, and Prisma passes it at each of these places: the family's own code imports it, and the CLI takes it from the target's contract serializer. The profile and execution hashes do not cover `storage`, so they are computed with a function that returns its input unchanged.

## Consequences

- A contract written in TypeScript and the same contract written in the Prisma schema language give the same file and the same hashes.
- A family that forgets to name a default writes the default into every contract. That is visible in the file and in review, and it is harmless to the hash as long as the family always writes it. The opposite mistake, leaving out a value that is not a default, is the one that makes two contracts share a hash, and it is possible only through a rule a family writes on purpose.
- An author of a type, an extension pack or a target can rely on Prisma to keep a `false`, `[]` or `{}` that appears inside the data they own.
- The rules, and each family's output for a given contract, do not change within a major version (ADR 332). A family may reorganise its normal form's code, but it must give the same output. So a family cannot name a new default to leave out within a major version: a contract that wrote that field out would get a new hash. Each family's test, `hash-rules.fixed-answers.test.ts`, holds saved contracts to literal hashes. It includes two contracts that differ only in that one has every named default written out and every ordered list out of order, and the other has them left out and in order; both must give the same storage hash.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, and let each family list the paths where they are kept.** Rejected, for the reasons under "Why": the framework cannot know which values are defaults, and every path left off the list loses a value from the file and the hash.
- **Require that `false` and empty always mean absent inside data a family does not own.** Rejected. It puts a convention nothing checks on authors outside this repository, and a violation gives two different contracts one hash.
- **Hand the framework content that each family has already normalised, with no function.** Rejected. A storage hash is also computed where no written file exists and checked against files read back, and every such place would have to remember to normalise first. With one required function, writing and hashing use the same normal form.
- **Compact JSON, with no whitespace, as the hash input.** Either encoding would serve; the indented one matches the printed `contract.json`, which people read in review. Changing it now would change every hash, which cannot happen within a major version.
- **Strict RFC 8785 (JSON Canonicalization Scheme) as the encoding.** Rejected. It would serve as well as the encoding chosen, but it differs from it: it prints with no whitespace and orders keys without putting array-index keys first. Adopting it would change every hash, which cannot happen within a major version. Defaults and list order would still be the family's job.
- **A binary canonical format such as Protobuf or CBOR.** Rejected. A contract is read and reviewed by people and by tools that expect JSON.
- **Keep the order of a table's indexes, uniques, foreign keys and checks in the hash.** Rejected. Reordering two relations in a model reorders their foreign keys, which would change the storage hash and ask for a migration that does nothing.
