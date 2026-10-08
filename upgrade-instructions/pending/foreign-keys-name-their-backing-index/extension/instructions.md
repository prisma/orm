---
changes:
  - id: bundled-contract-foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in a SQL `contract.json` now names its backing index, unique constraint or primary key in a new `index` field, so a bundled contract space with a foreign key gets a new storage hash. Regenerate the extension's bundled `contract.json` and `contract.d.ts` with its existing emission command.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: foreign-key-materialization-takes-one-input
    summary: |
      `materializeForeignKeysAndIndexes()` from `@internal/sql-contract/foreign-key-materialization` takes one object, `{ tableName, foreignKeys, declaredIndexes, uniques, primaryKey, warnings }`, where each declared index is `{ index, namedByUser }`, and a foreign key's `index` is `true`, `false` or the name of a declared index, unique constraint or primary key. `backingIndexColumnKeys()`, `isBackedByColumnKeys()` and `BackingIndexCandidates` are removed; the function itself removes indexes that duplicate another.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:materializeForeignKeysAndIndexes|backingIndexColumnKeys|isBackedByColumnKeys|BackingIndexCandidates)\b'
  - id: infer-relations-takes-default-index-kind
    summary: |
      `inferRelations()` from `@internal/family-sql/psl-infer` takes a third argument, `isDefaultIndexKind`, which says whether a live index is of the target's default kind. `buildChildRelationField()` takes `{ table, isDefaultIndexKind }` as its last argument instead of the table. A relation infers `index: false` unless a live default index, a unique constraint, a unique index without a predicate or the primary key is on exactly its columns.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:inferRelations|buildChildRelationField)\s*\('
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
  declaredIndexes: declaredIndexes.map((index) => ({ index, namedByUser: true })),
  uniques,
  primaryKey,
  warnings,
});
```

Set `namedByUser` to whether the source gave the index a `name` or `map`. An index that is not named by the user can be left out when it duplicates another, and the foreign keys that pointed at it then name the one that stays. Flush `warnings` the way the extension flushes its other authoring warnings, for example with `flushAuthoringWarnings` from `@internal/framework-components/authoring`. Code that called `backingIndexColumnKeys()` or `isBackedByColumnKeys()` to decide whether a foreign key needs a backing index reads the stored foreign key's `index` field instead.

## `infer-relations-takes-default-index-kind`

Pass a function that says whether a live index is of the target's default kind. On Postgres, that is an index with no access method or `btree`:

```ts
const { relationsByTable } = inferRelations(tables, modelNameMap, (index) =>
  (index.type ?? 'btree') === 'btree',
);
```

`buildChildRelationField(fieldName, parentModelName, fk, optional, relationName, table)` becomes `buildChildRelationField(fieldName, parentModelName, fk, optional, relationName, { table, isDefaultIndexKind })`.
