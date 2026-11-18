---
changes:
  - id: schema-tables-same-name
    summary: |
      In `@prisma/orm-family-sql/family/control`, `SchemaTables` gains a required `sameName(left, right)`: whether the database takes two table or column names for one, the comparison its `tablesNamed` and `columnsNamed` use. A `SchemaTables` or a test double of it adds `sameName`; use the new `exactName` export where names compare exactly.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])SchemaTables(?![\w$])'
  - id: plan-statements-plans-stored-name-renames
    summary: |
      `planStatements` from `@prisma/orm-family-sql/family/control` now plans a table or column rename for a model or field that keeps its name while its stored name changes, with no statement, whenever there is an origin contract. Its result, `PlannedStatements`, gains `alreadyRenamedTables` (tables whose rename the database already has, whose constraint renames a target puts before its creates) and `storageRenames` (a `StorageRenames`, or `undefined` with no origin contract). `StatementPlanningTarget` no longer extends `TableRenameByHand`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:planStatements|PlannedStatements|StatementPlanningTarget)(?![\w$])'
  - id: subjects-of-calls-storage-renames
    summary: |
      The context that `subjectsOfCalls` from `@prisma/orm-family-sql/family/control` takes gains a required `storageRenames`: the `storageRenames` of `planStatements`' result; `new StorageRenames([], fromContract, contract, exactName)` for a target that plans no renames; or `undefined` with no origin contract.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])subjectsOfCalls(?![\w$])'
  - id: stored-value-keep-data-edit-removed
    summary: |
      `StoredValueSubject.keepDataEdit` and the `keepData` and `swapsValues` fields of `StoredValueRewrite` (from `@prisma/orm-family-sql/family/control`) are gone, so the `dataLoss` entries of `CallSubjects` no longer carry `keepDataEdit`. A stored value whose member keeps its name is now rewritten by the plan, not asked about. Code that read these fields stops reading them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:keepDataEdit|swapsValues)(?![\w$])'
        - '\.keepData(?![\w$])'
---

# A changed stored name is a rename in the SQL family's planning

The SQL family now treats a model, field or enum member that keeps its contract name as the same object when its stored name or stored value changes. These changes to `@prisma/orm-family-sql/family/control` follow from it. The family also exports `StorageRenames`, `exactName`, `SameName` and `ModelTable` (which moved, and is still exported under the same name).

## `schema-tables-same-name`

Before:

```ts
const tables: SchemaTables = {
  hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
  hasTable: (namespaceId, table) => schema.hasTable(namespaceId, table),
  // ...
};
```

After:

```ts
import { exactName } from '@prisma/orm-family-sql/family/control';

const tables: SchemaTables = {
  sameName: exactName,
  hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
  hasTable: (namespaceId, table) => schema.hasTable(namespaceId, table),
  // ...
};
```

A database that compares names without case passes its own comparison, the same one its `tablesNamed` and `columnsNamed` use.

## `plan-statements-plans-stored-name-renames`

A target that calls `planStatements` keeps putting its `calls` first in the plan. The calls may now include renames no statement asked for. Put the renames of the constraints of each table in `alreadyRenamedTables` before the plan's creates. Pass `storageRenames` on to `subjectsOfCalls`, as below. An object literal typed as `StatementPlanningTarget` that also holds `renderTableRename` and `tableRenameByHand` keeps them only where a `TableRenameByHand` is expected.

## `subjects-of-calls-storage-renames`

Before:

```ts
subjectsOfCalls(subjects, { fromContract, contract, origins, byHand, removedVariants });
```

After, for a target that plans statements:

```ts
subjectsOfCalls(subjects, {
  fromContract,
  contract,
  origins,
  storageRenames: statements.value.storageRenames,
  byHand,
  removedVariants,
});
```

After, for a target that plans no renames:

```ts
import { exactName, StorageRenames } from '@prisma/orm-family-sql/family/control';

subjectsOfCalls(subjects, {
  fromContract,
  contract,
  origins: NO_RENAMED_ORIGINS,
  storageRenames:
    fromContract === null ? undefined : new StorageRenames([], fromContract, contract, exactName),
  byHand,
  removedVariants,
});
```

The advice on keeping the rows of a dropped table now comes from `storageRenames`; with `undefined`, a dropped table gets none.

## `stored-value-keep-data-edit-removed`

Remove reads of `keepDataEdit`, `keepData` and `swapsValues`. `keepRowsEdit` is unchanged and still gives the edit that keeps the rows a removal would lose.
