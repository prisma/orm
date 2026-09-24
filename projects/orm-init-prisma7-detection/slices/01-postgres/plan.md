# Slice 1 plan

**Spec:** `slices/01-postgres/spec.md`. Test-first throughout: tests before implementation in every dispatch.

**Validation gate (every dispatch):** in `packages/1-framework/3-tooling/cli`: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Dispatch 1 also runs the same in `packages/1-framework/3-tooling/config-loader` and `pnpm lint:deps` at the root. Save test output to a file and read it (`.agents/rules/running-tests.mdc`).

**Model tiers:** implementer Fable; reviewer Opus, mid effort.

## Dispatches

1. **Detection.** Outcome: `detectPrisma7Project` returns schema path, provider, Prisma 7 config file, and Prisma 7 CLI version for a project directory, with a config-loader export that evaluates a config module and returns its raw default export. Builds on: nothing. Hands to: the detection result type and its tests. Focus: `config-loader/src/load.ts` and `exports/index.ts`; new `cli/src/commands/init/prisma7-detect.ts`; tests beside them.

2. **Inputs.** Outcome: init resolves the Prisma 7 path from the flag or the question, refuses the four error cases before any write, asks the side-by-side consent, and returns the extended `ResolvedInitInputs`. Builds on: 1. Hands to: the inputs shape the scaffold consumes; new errors in `commands/init/errors.ts` and `docs/reference/error-reference.md`. Focus: `orm/init.ts` flags, `orm/init-inputs.ts`, `commands/init/errors.ts`, `test/orm/init-inputs.test.ts`, `init-prompts.test.ts`.

3. **Scaffold and installs.** Outcome: the Prisma 7 path writes the files in the spec, performs the side-by-side edits under consent, and installs the Prisma 7 packages; the fixture project exists. Builds on: 2. Hands to: the fixture project and a scaffold that the output layer reports. Focus: `orm/init-scaffold.ts`, `orm/init.ts` install specs, `commands/init/templates/*`, `commands/init/hygiene-*`, `test/fixture-app/fixtures/prisma7-project/`, `test/orm/init-scaffold.test.ts`, `init-install.test.ts`.

4. **Output, next steps, docs.** Outcome: the result document, human output, and next steps describe the Prisma 7 run; the CLI README documents it; the harness tests run the fixture end to end with the fake emit. Builds on: 3. Hands to: slice DoD minus the real-emit item. Focus: `commands/init/output.ts`, `orm/init-blocks.ts`, `orm/init.ts`, README, `test/orm/init-*.test.ts`.

5. **End to end with the real source.** Outcome: real `contract emit` and `prisma db sign` succeed against a dev database built from the fixture's Prisma 7 migration SQL. Builds on: 4 and PR #30287 merged into this branch. Hands to: slice DoD. Focus: a new `test/orm/init-prisma7.e2e.test.ts` and the fixture's `migration.sql`.

## Open items

- Dispatch 5 ran after PR #30287 merged; the merged `prisma7Schema` takes one argument and the facade owns `output`, which the template now reflects.

## Added 2026-09-16: user-acceptability fixes (PR back to draft)

6. **Check the schema before editing the project.** Done, in the form recorded in `design-notes.md` D10: the check installs the target package and `dotenv` into the project (not a temporary directory), runs the package's `prisma7Schema` from there before any consent question, and refuses with `CLI.INIT_PRISMA7_SCHEMA_REFUSED`. A package without `prisma7Schema` turns a run entered through the question into a fresh init and refuses a run given the flag with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`. The end-to-end test covers a fixture schema with a `view`.

7. **Cutover next step and re-run QA.** Replaced: the cutover step is removed rather than repointed (D10). The provider-derived target stays, the Mongo refusal is removed, and a `--target` that disagrees with the provider is refused (`CLI.INIT_PRISMA7_TARGET_MISMATCH`). Manual QA scenarios S10 to S12 cover the check and the exit after "Done".
