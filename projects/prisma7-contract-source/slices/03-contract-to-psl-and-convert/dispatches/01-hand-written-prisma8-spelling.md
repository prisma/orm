# Dispatch 1: hand-written Prisma 8 spelling of the supported fixture

**Slice plan:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/plan.md`
**Model tier:** Fable (implementer). **Time-box:** one session.

## Task

Prove, before any printer exists, that every construct the Prisma 7 source produces has a Prisma 8 PSL spelling that interprets back to the identical contract. Write the Prisma 8 `contract.prisma` for the `supported-verify` fixture by hand, following the printing-rules table in the slice spec, and a test that holds the round trip and `db verify` to it.

## Scope

In:

1. **The file** `test/integration/test/fixtures/prisma7-source/supported-verify/contract.prisma`, a Prisma 8 PSL document equivalent to `schema.prisma` beside it. Follow the slice spec's printing-rules table exactly (`@@map` on every table whose name is not `lowerFirst(model)`, unique indexes as `@@index(unique: true, map:)`, junction models as ordinary models with bare list fields on both joined models, `temporal.timestamp(3, onCreate: now, onUpdate: now)` for `@updatedAt`, `pg.enum(Handle)` with `@@map` on the block, `@noCheck(elementNotNull)` on list columns). Add one sentence to the fixture README saying what the file is.
2. **The test** `test/integration/test/prisma7-source/prisma8-spelling.integration.test.ts`: loads `schema.prisma` through `prisma7Schema` (as `supported.integration.test.ts` does) and `contract.prisma` through the PSL source (`prismaContract` from `@internal/sql-contract-psl/provider`, assembled the way the Postgres extension's `defineConfig` does; find the real call site rather than guessing), then asserts, with `toEqual`, `storage.storageHash`, `execution.executionHash`, `profileHash`, and the whole `domain` plane equal; then applies `../supported/migration.sql` to `withDevDatabase` and asserts `db verify` on the PSL-sourced contract reports zero findings. Put the four-way comparison in a small exported helper in that test directory so dispatches 2 and 3 reuse it.
3. **Write the test first** with an empty `contract.prisma` and quote the failing output in your report, then fill the file until green (F13).
4. **Record the findings** in a new section "Slice 3 spellings" of `projects/prisma7-contract-source/slices/01-postgres-source/verification-results.md`: for each row of the spec's printing-rules table, confirmed or corrected, with the exact PSL line that worked. Note in particular how the PSL interpreter paired the named (`Favorites`) and self-referential (`Follows`) many-to-many relations, and whether it needed `@relation("Name")` on the bare list fields.

Out: any production code under `packages/`. Any change to the PSL interpreter or parser. Any change to the Prisma 7 source. The printer.

## Completed when

- [ ] The test is green; the report quotes the first red run.
- [ ] `verification-results.md` has the "Slice 3 spellings" section with every table row addressed.
- [ ] `pnpm --filter integration-tests test prisma7-source` green; `pnpm --filter integration-tests typecheck` and `lint` green.

## Halt conditions

- A construct has no Prisma 8 spelling that reproduces the contract (hashes or domain differ for every spelling you can find). Stop, name the construct, the spellings you tried, and the diff. This is a feature to build in the PSL interpreter; you do not build it in this dispatch and you never relax a check.
- The domain plane differs only in something that is not user-visible (say what) and cannot be made equal: report it as a decision for the orchestrator with the exact diff.

## References

- Slice spec and plan (above). Project spec: `projects/prisma7-contract-source/spec.md`. Operator rules: `projects/prisma7-contract-source/design-notes.md` § Principles and § Open questions.
- Existing tests to copy from: `test/integration/test/prisma7-source/supported.integration.test.ts`, `test/integration/test/authoring/parity/` fixtures (native enums, map attributes, core surface), `packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.many-to-many.test.ts` (junction pairing), `test/integration/test/temporal-defaults/_fixture-timestamp/contract.prisma` (presets).
- PSL dialect: `packages/2-sql/2-authoring/contract-psl/README.md`. Prisma 7 rules: `packages/2-sql/2-authoring/contract-prisma7/README.md`.
- Repo rules: `CLAUDE.md`, `.agents/rules/running-tests.mdc` (save output under `wip/`, read the file), `.agents/rules/git-staging.mdc`. Failure modes F3, F5 (no destructive git), F13, F14 in `drive/calibration/failure-modes.md`.
- Commits: as the bot with both sign-offs: `git -c gpg.format=ssh -c gpg.ssh.program=ssh-keygen -c user.signingkey=~/.ssh/wmadden-electric_ed25519 commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" --trailer "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`. Never `--no-verify`, never `git stash`, never push.
- A shell hook rejects any Bash command containing the word "npm" (also inside strings). Use the file tools for such content.

## Heartbeat

Append a line to `wip/heartbeats/implementer.txt` every few minutes: ISO timestamp, phase, one sentence.

## Return shape

Report: paths produced; each "Completed when" item with evidence (quote the red run and the green run's summary line); the "Slice 3 spellings" findings in brief; halt conditions hit, if any, with the exact diff.
