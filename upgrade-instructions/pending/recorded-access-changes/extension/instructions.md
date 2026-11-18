---
changes:
  - id: control-family-access-changes-of
    summary: |
      `ControlFamilyInstance` (from `@prisma/orm-framework/components/control`) has a new required method, `accessChangesOf(operations)`. It takes the operations of one recorded migration and returns a `MigrationAccessChange` (`{ operationIndex, subject, widens }`) for each operation that changes who can read or write rows, `operationIndex` being its position in `operations`. `db migrate` refuses such a migration on a database whose data protection policy records `access-widening-forbidden`. Recognise an operation from its structure, such as its target details and the id its operation factory builds, never from its label. A family whose operations never change access returns `[]`. `SqlControlTargetDescriptor` (from `@prisma/orm-family-sql/control`) has a new required `accessChangesOf` with the same signature, which the SQL family instance calls; a SQL target with no operation that changes access sets `accessChangesOf: () => []`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*accessChangesOf)(?=[\s\S]*\bControlFamilyInstance\b)[\s\S]*\bstorageNameOf\s*[(:]'
        - '(?<![\s\S])(?![\s\S]*accessChangesOf)(?=[\s\S]*\bSqlControlTargetDescriptor\b)[\s\S]*\bclassifyEntityKind\s*:'
---

# A family names the recorded operations that change access

A family that implements `ControlFamilyInstance` itself adds `accessChangesOf` beside `storageNameOf`:

```ts
return {
  familyId: 'my-family',
  storageNameOf(operation) {
    return myStorageNameOf(operation);
  },
  accessChangesOf() {
    return [];
  },
  …
};
```

A SQL target adds `accessChangesOf` to its control target descriptor beside `classifyEntityKind`:

```ts
const descriptor: SqlControlTargetDescriptor<'my-target', MyPlanTargetDetails> = {
  …
  classifyEntityKind: relationalNodeEntityKind,
  accessChangesOf: () => [],
  …
};
```

A target with operations that change who can read or write rows, such as disabling row-level security or dropping a row-level-security policy, returns one entry for each, with `widens: true` when the operation only lets more people read or write and `false` when it can go either way. A test double of either one sets `accessChangesOf: () => []`.
