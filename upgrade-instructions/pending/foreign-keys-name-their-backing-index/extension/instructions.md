---
changes:
  - id: bundled-contract-foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in a SQL `contract.json` now states what backs it in a new `index` field: `{ "name": "<index>" }`, `{ "primaryKey": true }` or `{ "unique": true }`, absent for `index: false`. A bundled contract space with a foreign key gets a new storage hash. Regenerate the extension's bundled `contract.json` and `contract.d.ts` with its existing emission command.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: foreign-key-materialization-takes-one-input
    summary: |
      `materializeForeignKeysAndIndexes()` from `@internal/sql-contract/foreign-key-materialization` takes one object, `{ tableName, foreignKeys, declaredIndexes, uniques, primaryKey, warnings }`, where each declared index is `{ index, namedByUser }`, and a foreign key's `index` is `true`, `false` or the name of a declared index, unique constraint or primary key. `backingIndexColumnKeys()`, `isBackedByColumnKeys()` and `BackingIndexCandidates` are removed; `derivedBackingIndexIsRedundant()` answers whether a table already serves a foreign key's lookups, by the rule the build uses.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:materializeForeignKeysAndIndexes|backingIndexColumnKeys|isBackedByColumnKeys|BackingIndexCandidates)\b'
---

## `bundled-contract-foreign-keys-name-their-backing-index`

Regenerate the bundled `contract.json` and `contract.d.ts` from the extension's authoring source with its existing emission command. Only contracts with a foreign key change. A database signed with the previous contract space needs `prisma db sign`; say so in the extension's release notes.

## `foreign-key-materialization-takes-one-input`

Before:

```ts
const { foreignKeys, indexes } = materializeForeignKeysAndIndexes(
  tableName,
  authoredForeignKeys,
  declaredIndexes,
  uniques,
  primaryKey,
);
```

After:

```ts
const warnings: AuthoringWarning[] = [];
const { foreignKeys, indexes } = materializeForeignKeysAndIndexes({
  tableName,
  foreignKeys: authoredForeignKeys,
  declaredIndexes: authoredIndexes.map((authored) => ({
    index: lowerAuthoredIndex(tableName, authored, warnings),
    namedByUser: authored.name !== undefined || authored.map !== undefined,
  })),
  uniques,
  primaryKey,
  warnings,
});
flushAuthoringWarnings(warnings);
```

`namedByUser` says whether the source gave the index a `name` or `map`. An index not named by the user is left out when it duplicates another, and foreign keys that pointed at it then name the one that stays. `flushAuthoringWarnings` comes from `@internal/framework-components/authoring`.

Code that called `backingIndexColumnKeys()` or `isBackedByColumnKeys()` to decide whether a foreign key needs a backing index reads the stored foreign key's `index` instead: `{ name }` names an index of the table, `{ primaryKey: true }` and `{ unique: true }` say a primary key or unique constraint whose first columns are the foreign key's columns serves it, and an absent `index` says nothing does. To ask the question of a live table, call `derivedBackingIndexIsRedundant(columns, { indexes, nodeOf, uniques, primaryKey })`, as `contract infer` does.
