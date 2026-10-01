---
changes:
  - id: non-data-drops-are-widening
    summary: |
      Dropping an index, a unique, primary-key or foreign-key constraint, a check constraint, a row-level-security policy, a column default or a Postgres enum type, and disabling row-level security on a table, is now a `widening` operation, not a `destructive` one, because it loses no stored data. `db update` and `migration plan`'s baseline confirmation no longer ask for consent for them, and a policy that allows `widening` but not `destructive` now plans them. Do not re-emit existing migrations that call the matching migration methods.
    detection:
      glob: "**/migration.ts"
      matches:
        - '(?<![\w$])(?<![\w$]\.)this\.(?:dropIndex|dropConstraint|dropCheckConstraint|dropRlsPolicy|disableRowLevelSecurity|dropDefault|dropNativeEnumType)\('
  - id: contract-definition-requires-hints
    summary: |
      `ContractDefinition`, exported from `@prisma/orm-postgres/contract-builder`, `@prisma/orm-sqlite/contract-builder` and `@prisma/orm-family-sql/contract-ts/contract-builder`, has a new required field `hints: readonly HintEntry[]`. A `ContractDefinition` built by hand needs `hints: []`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])ContractDefinition(?![\w$])[^}]*\}\s*from\s*[''"]@prisma/orm-(?:postgres/contract-builder|sqlite/contract-builder|family-sql/contract-ts/contract-builder)[''"]'
  - id: migration-plan-prints-planner-warnings
    summary: |
      `prisma migration plan` now prints the planner's warnings, such as `control policy suppressed: …` for a table whose control policy is `tolerated`, `observed` or `external`, in its human output and in the `warnings` of its `--json` result.
---

## `non-data-drops-are-widening`

An operation is `destructive` only when applying it can lose rows or stored values: dropping a table, dropping a column, and narrowing a column's type or nullability. Everything the contract can recreate is now `widening`:

- On Postgres: dropping an index, a unique, primary-key or foreign-key constraint, a check constraint, a row-level-security policy, a column default, and a native enum type; and disabling row-level security on a table.
- On SQLite: dropping an index. A table rebuild that only changes a primary key, a foreign key, a unique constraint or a column default is `widening`; a rebuild that changes a column's type or makes it non-nullable stays `destructive`.

What changes for you:

1. `prisma db update` no longer asks you to type the database name, and no longer needs `--confirm` in CI, for a plan whose only drops are of these kinds. `prisma migration plan` likewise no longer asks for the project directory name, or needs `--no-interactive --confirm <directory>`, for a baseline whose only drops are of these kinds. A plan that drops a table or a column still asks.
2. Dropping a row-level-security policy, or disabling row-level security on a table, loses no data but can widen who sees which rows. Read the plan before applying it if your schema relies on policies.
3. An existing migration on disk keeps the `ops.json` and the hash it was written with, so `migrate` applies it as before. Do not re-run the `migration.ts` of an existing migration that calls `this.dropIndex`, `this.dropConstraint`, `this.dropCheckConstraint`, `this.dropRlsPolicy`, `this.disableRowLevelSecurity`, `this.dropDefault` or `this.dropNativeEnumType`: it would now write `operationClass: "widening"` for those operations, a different `ops.json` and a different migration hash, which `prisma migration check` reports as a changed migration. If you re-emitted one, restore its `ops.json` and `migration.json` from version control.

The detection finds `migration.ts` files that call one of the seven methods on `this`. MongoDB migrations call `dropIndex(...)` as a plain function, which the detection does not match, and their operations did not change.

## `contract-definition-requires-hints`

`ContractDefinition` is the input of `buildSqlContractFromDefinition`. It now carries the model rename hints the contract records, in a required field `hints: readonly HintEntry[]`. `defineContract` and the PSL source fill it for you; only a `ContractDefinition` you build by hand needs the field. Add `hints: []` to each such object literal, or one entry per renamed model if you want the contract to record a rename hint.

The detection finds TypeScript files that import `ContractDefinition` from one of the three paths. A file that only imports the type to read a definition needs no change; TypeScript reports the missing field where an object literal is built.

## `migration-plan-prints-planner-warnings`

`prisma migration plan` used to print only its own warnings about where the plan starts. It now also prints each warning the planner reports. On Postgres that includes `control policy suppressed: …` for every change to a table whose control policy is not `managed`, which `db update` already printed. The same lines appear in the `warnings` array of `--json` output. A CI script that fails on any JSON warning from `migration plan` now fails for a project whose tolerated, observed or external tables have drifted. Nothing in your code needs to change; adjust such a script if it should not fail on these warnings.

