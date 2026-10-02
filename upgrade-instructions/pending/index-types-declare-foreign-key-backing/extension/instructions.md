---
changes:
  - id: index-types-declare-backs-foreign-key
    summary: |
      Every index type registered with `defineIndexTypes().add(...)` or `IndexTypeRegistry.register(...)` declares `backsForeignKey: true | false`. A registration without it is refused with `CONTRACT.PACK_CONTRIBUTION_INVALID` when a contract is built or inferred.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdefineIndexTypes\s*\('
        - '\.register\s*\(\s*\{\s*type\s*:'
  - id: foreign-key-backing-takes-the-index-type-rule
    summary: |
      `backingIndexColumnKeys`, `materializeForeignKeysAndIndexes`, `inferRelations` and `buildChildRelationField` take the rule that says whether an index type can back a foreign key, and `SqlPslBuildContext` carries it as `indexTypes`. An index with a `where` predicate never backs a foreign key.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(backingIndexColumnKeys|materializeForeignKeysAndIndexes|inferRelations|buildChildRelationField)\s*\('
        - '\bSqlPslBuildContext\b'
---

# An index backs a foreign key only if it can serve its lookups

## `index-types-declare-backs-foreign-key`

A foreign key gets a derived backing index unless an index of its table already covers its columns. An index of a registered type counts only when its registration says the type can serve the foreign key's lookups. Declare it for each type your pack registers:

```diff
 export const myIndexTypes = defineIndexTypes()
-  .add('bm25', { options: bm25Options });
+  .add('bm25', { options: bm25Options, backsForeignKey: false });
```

Declare `true` only for a type whose index answers equality lookups on its leading columns, as a btree or hash index does. A search, spatial or range-summary index declares `false`. A direct `IndexTypeRegistry.register({ type, options })` call adds `backsForeignKey` the same way.

## `foreign-key-backing-takes-the-index-type-rule`

The functions that decide whether a foreign key is already backed take the rule as an argument:

```diff
-backingIndexColumnKeys({ indexes, uniques, primaryKey })
+backingIndexColumnKeys({ indexes, uniques, primaryKey }, (indexType) => registry.backsForeignKey(indexType))

-materializeForeignKeysAndIndexes(table, foreignKeys, declaredIndexes, uniques, primaryKey)
+materializeForeignKeysAndIndexes(table, foreignKeys, declaredIndexes, uniques, primaryKey, backsForeignKey)

-inferRelations(tables, modelNameMap)
+inferRelations(tables, modelNameMap, backsForeignKey)

-buildChildRelationField(name, parentModel, fk, optional, relationName, hostTable)
+buildChildRelationField(name, parentModel, fk, optional, relationName, { table: hostTable, backsForeignKey })
```

Build the registry with `indexTypeRegistryOf([target, ...extensionPacks])` from `@internal/sql-contract/index-types`; `registry.backsForeignKey(type)` answers the rule for the registered types and returns `false` for any other. A target's `inferPslContract` hook reads the same answer from `context.indexTypes.backsForeignKey`; code that builds a `SqlPslBuildContext` by hand adds `indexTypes`.
