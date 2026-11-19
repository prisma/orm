## Dispatch plan

Slice spec: `projects/nested-mutations/slices/has-one-unique/spec.md`. Two dispatches, sequential. Tests are written before the implementation.

### Dispatch 1: the rule

- **Outcome:** `lowerRelations` refuses a local `1:1` relation whose child columns are not equal, as a set, to the child model's primary key, a unique constraint, or a unique index with columns and no `where`, with `CONTRACT.RELATION_INVALID` and the message and meta the spec gives. Unit tests through `defineContract` cover every case listed in the spec's scope. Every test in `packages/2-sql-family/2-authoring/contract-ts` and `contract-psl` passes, with the package's own tests that declared a `hasOne` or `1:1` over a non-unique key fixed.
- **Builds on:** The slice spec's chosen design.
- **Hands to:** The rule in the shared build, so that every TypeScript contract with a non-unique `hasOne` key now throws when built; dispatch 2 fixes the in-repo ones.
- **Focus:** `model-relations.ts` and the `contract-ts` / `contract-psl` package tests only. No fixture outside these packages, no docs, no upgrade entry. Stop and report if a variant's model node lacks the unique sets of its key (spec, edge cases).

### Dispatch 2: in-repo contracts, docs, upgrade entry, slice gates

- **Outcome:** The contracts in the spec's table have `.unique()` on the child key, their generated fixtures are regenerated, and every other contract in the repo that the rule now refuses is fixed the same way. The `rel.hasOne` bullet of ADR 181 (and the `contract-ts` README if it describes `hasOne`) states the requirement. The pending upgrade entry `upgrade-instructions/pending/has-one-unique/app/` exists, written with the `record-upgrade-instructions` skill. Gates pass: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm test:packages`, the integration and e2e suites that use the changed fixtures (sql-builder, contract-parity, e2e sqlite), and the upgrade-coverage check.
- **Builds on:** Dispatch 1's rule.
- **Hands to:** The slice ready for its PR.
- **Focus:** Fixtures, docs and the upgrade entry; the rule is not changed here. A `UNIQUE` is added to hand-written `CREATE TABLE` SQL only if a test compares the database schema with the contract. Any contract the rule refuses that is not in the spec's table is reported in the dispatch report.
