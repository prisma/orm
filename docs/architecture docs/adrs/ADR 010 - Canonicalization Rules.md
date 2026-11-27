# ADR 010 — Canonicalization Rules for contract.json

**Status:** Accepted
**Domain:** Contract & Schema

## At a glance

A contract's storage hash is the SHA-256 of exactly this text: the target, the family and the `storage` section, with every key sorted, printed with a two-space indent.

```json
{
  "storage": {
    "namespaces": {
      "public": {
        "entries": {
          "table": {}
        },
        "id": "public"
      }
    }
  },
  "target": "postgres",
  "targetFamily": "sql"
}
```

The framework produced that text by sorting keys and nothing else. What is inside `storage` was decided by the SQL family: it left out the fields it defines as defaults and ordered the lists whose order means nothing.

## Decision

Canonicalization is split between two owners.

- **The framework sorts and encodes.** It does not know what any field means, so it leaves out no value and reorders no list.
- **Each family owns the normal form of its own content.** A family gives the framework one function, `normalizeStorage`, which leaves out the fields that family defines as defaults and orders the lists whose order means nothing to the database.

The framework applies the family's function to `storage` both when it writes a contract and when it computes or checks a storage hash. A value is therefore in the hash input exactly when it is in the written `storage`. The one exception is a namespace's `kind`, which is written and which the storage hash leaves out ([ADR 332](ADR%20332%20-%20A%20hash%20covers%20what%20a%20contract%20means%2C%20by%20rules%20that%20do%20not%20change%20within%20a%20major.md)).

Which sections each hash covers, and the rule that none of this changes within a major version, are in ADR 332. This record says how a section becomes the text that is hashed and the file that is written.

## Why

Prisma records the hashes in a project's files and in its databases, and compares them to decide whether a database matches a contract and whether two migrations connect. Two properties follow.

- **The same contract must always give the same text.** A contract written in TypeScript and the same contract written in the Prisma schema language must hash the same, on any machine. That needs a fixed key order, a fixed encoding and one form for every default.
- **Two contracts that require different databases must never give the same text,** and a written contract must hold every value its author wrote. So a value may be left out only by the owner who knows that the absent field and the value mean the same.

A value's shape does not say whether it is a default. `false` on a column's `many` means "not a list", which is also what an absent `many` means. `false` inside a PostgreSQL index's options, as in `{ "fastupdate": false }`, is a setting the user chose. Only the family knows the first, and nobody but the user knows the second. That is why the framework leaves out nothing and each family names what it leaves out.

## The rules

### What the framework does

- **Keys.** Every object's keys are sorted by UTF-16 code unit, at every depth.
- **Arrays.** Every array keeps the order it is given in.
- **Encoding.** The result is printed by `JSON.stringify` with a two-space indent. Numbers, booleans, `null` and string escapes are as `JSON.stringify` prints them. The indent is part of the rule: the same JSON printed without it has a different hash.
- **Hash.** SHA-256 of that text as UTF-8, written as lowercase hexadecimal with no prefix. Nothing in a hash names the rules that produced it; [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md) gives the same reasoning for wire names.

A hash is computed from parsed sections, never from the bytes of a file. A check of a stored contract parses the file and hashes its sections again.

### What a family does

A family's normal form does two things to `storage`.

**It leaves out the family's own defaults.** A family leaves out a field only where the family itself defines the absent field and the value to mean the same, and it names each such field. Nothing is left out because of the shape of its value.

| Family | Left out |
| --- | --- |
| SQL | a column's or field's `many: false`; a table's empty `checks`; an index's empty `columns` or empty `options`; a foreign key's `index` flag, and its `onDelete` or `onUpdate` of `noAction`; an empty `typeParams`; an empty map of entries of a kind other than `table` |
| MongoDB | a collection's empty `indexes`; an index's `unique` or `sparse` of `false`; a collation's `caseLevel` or `numericOrdering` of `false`; empty `required` and `properties` in the validator derived from the models; a field's `many: false`; an empty map of entries of a kind other than `collection` |

`nullable` is always written ([ADR 172](ADR%20172%20-%20Contract%20domain-storage%20separation.md)). A MongoDB collation's `backwards` and `normalization` are always kept, because the server's default for them depends on the locale.

**It orders the lists whose order means nothing to the database.** The SQL family orders a table's checks, foreign keys, indexes and unique constraints by name, and an entry without a name by its content. The MongoDB family orders a collection's indexes by name, and indexes with the same name by their content. Reordering them in the contract source changes no hash. Lists whose order has meaning keep it: the columns of a composite key, the keys of a MongoDB index, the members of a value set.

**Everything else is kept exactly as given.** That includes the data a family carries without owning: a type's parameters, an index's options, a MongoDB partial filter expression, a generator's parameters, the members of a value set, and every field of an entry that a target or an extension pack defines.

A family also leaves its own defaults out of the `domain` section when it writes it, for example a field's `many: false`. `domain` is not hashed. A capability flag that is off is left out by the code that builds the capability list, so `capabilities` holds only flags that are on.

### What an author of an entry kind does

Only a family names defaults. Every field of an entry that a target or an extension pack defines is hashed exactly as given. So the author gives each field one form: the field is required, or its constructor stores the default in one way only. Otherwise a value written out and the same value left out are one meaning with two storage hashes, and that cannot be corrected within a major version.

### The written files

Prisma writes a contract in two forms. Neither is a hash input.

- **The emitted `contract.json`** is printed with a two-space indent and no trailing newline. Its top-level keys are in a fixed presentation order, which keeps the identity and the hashes at the top and `meta` last; every other key is sorted. The order is `TOP_LEVEL_ORDER` in `packages/1-framework/0-foundation/contract/src/canonicalization.ts`, and a new top-level section is added there.
- **A snapshot's copy**, under `migrations/snapshots/<storage hash>/`, is compact JSON with every key sorted and a trailing newline.

`meta` is for tooling. It does not change what a contract means and is in no hash.

### Who computes and who checks

- The family's authoring code computes the storage hash when it builds the contract.
- The emitter writes it, and refuses to write a `storage` section that does not hash to it.
- A reader of a snapshot, and the check of the contract an extension package ships, hash the stored `storage` again and refuse a mismatch.

Each of them is given the family's `normalizeStorage`; there is no way to compute a storage hash without it.

## Consequences

- A contract written in TypeScript and the same contract written in the Prisma schema language give the same file and the same hashes.
- A family that forgets to name a default writes the default into every contract. That is visible in the file and in review, and it is harmless to the hash as long as the family always writes it. The opposite mistake, leaving out a value that is not a default, is the one that makes two contracts share a hash, and it now needs a rule someone wrote on purpose.
- An author of a type, an extension pack or a target can rely on Prisma to keep `false`, `[]` and `{}` inside the data they own.
- The rules, and each family's output for a given contract, do not change within a major version (ADR 332). A family may reorganise its normal form's code, but it must give the same output. A test in each family holds saved contracts, each with every named default once written out and once left out, to one hash.

## Alternatives considered

- **Have the framework leave out every `false`, empty array and empty object, and let each family list the paths where they are kept.** Rejected. The framework cannot know which of those values are defaults, so every value that was not one had to be found and listed. Where the list was incomplete, the value was lost from the file and from the hash: an index's options `{ "fastupdate": false }` were written as `{}`, a MongoDB partial filter `{ "isAdmin": false }` was written as a filter that matches every document, and two types whose parameters differed only by such a value had one storage hash.
- **Require that `false` and empty always mean absent inside data a family does not own.** Rejected. It puts a convention nothing checks on authors outside this repository, and a violation gives two different contracts one hash.
- **Hand the framework content that each family has already normalised, with no function.** Rejected. A storage hash is also computed where no written file exists and checked against files read back, and every such place would have to remember to normalise first. With one required function, writing and hashing cannot differ.
- **Compact JSON, with no whitespace, as the hash input.** Rejected. The emitted file is indented so that it can be read and diffed, and the hash input is printed the same way so that there is one printing rule.
- **Strict RFC 8785 (JSON Canonicalization Scheme).** Rejected. It fixes the encoding but says nothing about defaults or list order, which are where two forms of one contract come from.
- **A binary canonical format such as Protobuf or CBOR.** Rejected. A contract is read and reviewed by people and by tools that expect JSON.
- **Leave the order of foreign keys and MongoDB indexes in the hash.** Rejected. Reordering two relations in a model would change the storage hash and ask for a migration that does nothing.
