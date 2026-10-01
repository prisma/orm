# Slice spec — TS DSL cross-space relation table fallback

**Project:** `projects/psl-verbatim-table-names/` · **Slice 3** · **Branch:** `psl-verbatim-ts-dsl-relation-fallback` (from `main`)

## At a glance

In the TypeScript authoring DSL, a `belongsTo` relation whose target model lives in another contract space resolves the target table as `relation.tableName ?? targetModelName.toLowerCase()` in `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts` (around line 456). `OrderItem` becomes `orderitem`, which is neither the DSL's identity naming default nor any naming strategy the DSL offers. It is the same class of defect as the PSL default this project removed: an implicit case transform.

## Chosen design

Never guess a table name. Two paths carried the lowercase guess:

- The relation node. For a cross-space relation with no `tableName`, `toTable` and `on.childTable` are left undefined rather than fabricated. Their only reader in `build-contract.ts` already skips cross-space relations, so no consumer changes behaviour.
- The foreign-key node (`lowerCrossSpaceForeignKeyNode`). Its target table is written into `contract.json` and into the `REFERENCES` clause of the DDL, and nothing resolves it against the remote contract later. A guessed name there is a foreign key to a table that may not exist. So when a cross-space foreign key targets a handle with no statically readable table, lowering throws `CONTRACT.FOREIGN_KEY_INVALID`, naming the source model, the target model and the space, and telling the author to declare the target model's `.sql()` stage with a static object carrying `table`. That is the only way a cross-space handle can carry its table today; there is no per-relation table option.

Amended after review: the original text claimed the foreign-key path already left the table unset and the planner resolved it. The reviewer traced the value into the emitted contract and the DDL; neither claim held.

## Why `tableName` can be undefined

`ContractModelBuilder.tableName` is only populated when `.sql()` receives a static object with `table`. A model whose `.sql()` stage is a factory function (`sql(({ cols }) => ({ table: ..., ... }))`) has no statically readable table, so a cross-space handle to it carries no `tableName`. No existing test exercises that shape; every cross-space fixture uses a static `.sql({ table: 'users' })`.

## Scope

**In:** the lowering change; the relation-node type change if the primary design is taken; a test in `packages/2-sql/2-authoring/contract-ts/test/cross-space-relation.test.ts` (or `cross-space-fk.test.ts`) with a branded cross-space handle whose `.sql()` is a factory function and whose model is a two-word PascalCase name such as `OrderItem`, asserting the relation node carries no fabricated table; and a test in `cross-space-fk.test.ts` asserting the structured error for a cross-space foreign key to such a handle. Both must fail on `main`.

**Out:** same-space relations; the naming-strategy machinery (`applyNaming`); any change to how the planner resolves remote tables.

## Done conditions

- The new test is red on `main` and green on the branch.
- No `.toLowerCase()` on a model name remains in `packages/2-sql/2-authoring/contract-ts/src`.
- `@internal/sql-contract-ts` build, typecheck, test, and lint pass; `pnpm lint:deps` passes; `pnpm test:packages` passes once on the final tree.
- Upgrade coverage: run `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD`; no example or extension should change, so no fragment is expected. If the check demands one, report rather than write a `changes: []` fragment without checking it is truthful.

## Dispatch plan

1. Red test only, committed alone.
2. The change, gates, commit. Push with `git push -u bot psl-verbatim-ts-dsl-relation-fallback`; do not open the PR (the orchestrator writes the PR text).
