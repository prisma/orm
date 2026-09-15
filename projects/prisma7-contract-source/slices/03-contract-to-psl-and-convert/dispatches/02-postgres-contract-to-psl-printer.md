# Dispatch 2: the Postgres contract-to-PSL printer

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Build the hook that prints a Postgres family contract as a Prisma 8 `PslDocumentAst`, so that for every Prisma 7 fixture the printed text interprets back to the same contract (three hashes and the domain plane), reaching by code the spelling dispatch 1 reached by hand.

## Scope

In, one commit per numbered item:

1. **Printer header option.** `printPsl` in `@internal/psl-printer` takes an optional `header` (the comment lines after `// use prisma-8`); the default stays infer's current text so `contract infer` output is unchanged. Test first in the printer package.
2. **The hook, plumbing only.** A framework capability `PslContractPrintCapable` with a guard beside `PslContractInferCapable`; an optional `printPslContract(contract)` hook on the SQL target descriptor; the SQL family instance declares and dispatches it (throwing a structured `CONTRACT.CONVERT_UNSUPPORTED` when the target omits it); `ControlClient.printPslContract` in the CLI control API returning `undefined` when the capability is absent; the fixture-client double and every mock that enumerates the client surface updated. Follow the registration list for `inferPslContract` in `packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts`, `packages/2-sql/9-family/src/core/control-target-descriptor.ts`, `control-instance.ts`, `packages/3-targets/3-targets/postgres/src/exports/control.ts`, `packages/1-framework/3-tooling/cli/src/control-api/{types,client}.ts`, `control-api/testing/fixture-client.ts`. Tests mirror the infer ones.
3. **The Postgres printer** under `packages/3-targets/3-targets/postgres/src/core/psl-print/`, mirroring `psl-infer/` and reusing its AST literal helpers (`psl-literals.ts`), the index attribute builder, the type map, and the default mapping table (`postgres-default-mapping.ts`; the raw-expression arm goes through that table and nowhere else). Implement every row of the slice spec's printing-rules table as corrected by dispatch 1's "Slice 3 spellings" findings. A construct with no spelling throws an `InternalError` naming the model, field, and construct.
4. **Round trip tests** in the Postgres target package: for every case under `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/` that has an `expected-contract.json`, load through `prisma7Schema` with the real control stack (copy `contract-prisma7/test/support.ts`'s assembly), print, interpret with the PSL source, and assert the three hashes and the domain plane equal, using dispatch 1's helper or a copy of it if the package boundary forbids the import. Also snapshot the printed text for `supported-verify` and diff it against dispatch 1's hand-written file: differences are allowed only in whitespace, comments, and ordering; state each one in the report.

Out: the `contract convert` command. Mongo. Any change to the PSL interpreter or parser. Any change to the Prisma 7 source, unless a fixture's `expected-contract.json` is provably wrong; then stop and report.

## Completed when

- [ ] Every fixture case round-trips; the test list in the report names them.
- [ ] `contract infer` output is byte-identical before and after (the infer tests and `pnpm fixtures:check` prove it).
- [ ] Package `test`, `typecheck`, `lint`, `build` for every touched package; `pnpm lint:deps`; root typecheck; `pnpm --filter integration-tests test prisma7-source` still green.

## Halt conditions

- A fixture case cannot round-trip with any spelling. Name the case and the construct; stop. Feature to build, never a relaxed check.
- The capability needs a change in `@prisma/cli-engine` (external). Report the constraint.

## References

- Dispatch 1's findings: `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md` § Slice 3 spellings, and the hand-written `test/integration/test/fixtures/prisma7-source/supported-verify/contract.prisma`.
- Infer as the template: `packages/3-targets/3-targets/postgres/src/core/psl-infer/*.ts`, `packages/1-framework/3-tooling/cli/src/orm/contract/infer.ts`.
- Rules: `CLAUDE.md` (no `any`, no bare `as`, `blindCast`/`castAs`, interface plus factory), `.agents/rules/running-tests.mdc`, `.agents/rules/git-staging.mdc`, `.agents/rules/no-barrel-files.mdc`, `.agents/rules/import-validation.mdc`. Failure modes F1, F3, F5, F13, F14, F16, F24.
- Commits, heartbeat, return shape: as dispatch 1.
