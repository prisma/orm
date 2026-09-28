---
changes:
  - id: mutation-default-generator-types-move-to-framework
    summary: |
      `GeneratorStability` and `RuntimeMutationDefaultGenerator` are no longer exported by the SQL
      runtime (`@prisma/orm-family-sql/runtime`, `@prisma/orm-postgres/family-runtime`,
      `@prisma/orm-sqlite/family-runtime`). Import them from `@prisma/orm-framework/components/runtime`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bimport\s+(?:type\s+)?\{[^}]*\b(?:GeneratorStability|RuntimeMutationDefaultGenerator)\b[^}]*\}\s*from\s*[''"](?:@internal/sql-runtime|@prisma/orm-family-sql/runtime|@prisma/orm-(?:postgres|sqlite)/family-runtime)[''"]'
  - id: mutation-defaults-options-entry-field
    summary: |
      `applyMutationDefaults` options name the storage entry as `entry` instead of `table`, and each
      applied default names its field as `field` instead of `column`. `MutationDefaultsOptions`,
      `AppliedMutationDefault` and `MutationDefaultsOp` now come from
      `@prisma/orm-framework/components/runtime`, not from the SQL `relational-core/query-lane-context` subpath.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bapplyMutationDefaults\s*\(\s*\{[^{}]*\btable\s*:'
        - '\bimport\s+(?:type\s+)?\{[^}]*\b(?:AppliedMutationDefault|MutationDefaultsOptions|MutationDefaultsOp)\b[^}]*\}\s*from\s*[''"](?:@internal/sql-relational-core/query-lane-context|@prisma/orm-(?:family-sql|postgres|sqlite)/relational-core/query-lane-context)[''"]'
---

## `mutation-default-generator-types-move-to-framework`

The mutation-default generator runtime now lives in the framework and serves every family. A pack that contributes generators (`mutationDefaultGenerators: () => [...]` on a runtime target, adapter, or extension descriptor) types them with the framework type:

```ts
// before
import type { RuntimeMutationDefaultGenerator } from '@prisma/orm-family-sql/runtime';

// after
import type { RuntimeMutationDefaultGenerator } from '@prisma/orm-framework/components/runtime';
```

Do the same for `GeneratorStability`. The shape is unchanged: `{ id, generate(params?), stability: 'field' | 'row' | 'query' }`.

## `mutation-defaults-options-entry-field`

Code that calls `applyMutationDefaults` on an execution context, or stubs it in tests, renames two keys:

```ts
// before
const applied = context.applyMutationDefaults({ op: 'create', table: tableName, namespace, values });
for (const def of applied) row[def.column] = def.value;

// after
const applied = context.applyMutationDefaults({ op: 'create', entry: tableName, namespace, values });
for (const def of applied) row[def.field] = def.value;
```

1. In every `applyMutationDefaults({ ... })` call, rename the `table` key to `entry`. The value is the same table name.
2. Where the result is read, rename `.column` to `.field`. A stub that returns applied defaults returns `{ field, value }`.
3. Import `MutationDefaultsOptions`, `AppliedMutationDefault` and `MutationDefaultsOp` from `@prisma/orm-framework/components/runtime`; the SQL `relational-core/query-lane-context` subpath no longer exports them.

A key present in `values` counts as explicit whatever its value, `undefined` included, and gets no default. That rule is unchanged; drop `undefined` values before the call if they should be defaulted.
