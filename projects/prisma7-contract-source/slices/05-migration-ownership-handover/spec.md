# Slice 5: Prisma 8 takes over migrations from the Prisma 7 schema

_Parent project: `projects/prisma7-contract-source/`. Linear: TML-3451. Outcome: a test in `examples/prisma7-adoption` proves that Prisma 8 can plan and apply migrations from a Prisma 7 `schema.prisma` read through `prisma7Schema(...)`, while Prisma 7 keeps generating the client that serves queries. Every defect found on that path is fixed in the same PR._

## At a glance

The user's loop after the handover, starting from a database Prisma 7 built:

```bash
prisma contract emit            # Prisma 8 reads prisma/schema.prisma
prisma db sign                  # marker, snapshot, `db` ref            (already in the existing story)
# edit prisma/schema.prisma in the Prisma 7 dialect
prisma contract emit
prisma migration plan --name add-profiles   # first run: baseline bundle + delta bundle (auto-baseline)
prisma db migrate --advance-ref db          # applies the delta; marker and `db` ref move to the new hash
prisma db verify --strict                   # exit 4: unclaimed ["_prisma_migrations"], nothing else
prisma7 generate                            # Prisma 7 client sees the new columns
```

Nobody has run this end to end. The test is the first proof.

## Chosen design

- **Where.** A second test file in `examples/prisma7-adoption/test/` (or a second `it` in `adoption.test.ts`). The existing test stays unchanged: it proves the fallback story where Prisma 7 keeps owning migrations. Reuse `createStoryCopy`, `withDevDatabase`, the `v7`/`v8`/`tsx` helpers and `verifyHasNoFindings`; extract shared helpers into a module under `test/` if two files need them.
- **Starting point.** Prisma 7 has applied both of its migrations (`20260914000000_init`, `20260914000100_add_post_view_count`). Then `contract emit`, `db sign`, `db verify` with zero findings, `prisma7 generate`, seed.
- **Baseline.** No explicit baseline step. `db sign` already wrote the snapshot and the `db` ref. With an empty migration graph and a `db` ref, the first `migration plan --name <change>` runs the auto-baseline path (`control-api/operations/plan-resolution.ts`, `migration-plan.ts`): a `null → signed-hash` baseline bundle plus a `signed-hash → new-hash` delta bundle. Consent is only requested when the baseline leg is destructive, which a create-everything baseline is not. The test asserts both bundles exist and that the baseline's `to` equals the signed hash. If this does not work on a `prisma7Schema` source, that is a defect to fix, not a reason to fall back to `migration ref set`.
- **Applying.** `db migrate --advance-ref db`. Plain `db migrate` moves the marker but never the `db` ref, so the next `migration plan` would resolve `from` wrongly without the flag. Assert via `db migrate --json`: `migrationsApplied`, `markerHash` equals the new contract hash; and `migrations/app/refs/db.json` holds the same hash.
- **Verifying.** `db verify --strict --json` exits 4. The JSON result has `unclaimed: ["_prisma_migrations"]` and no schema findings. Assert the exact list so the test fails if anything else appears and also fails when the ledger stops being unclaimed. The helper must tolerate the nonzero exit. The non-strict `verifyHasNoFindings` still passes too.
- **Edit 1 (additive).** On the Prisma 7 schema:
  - `User.bio String?` (nullable column)
  - `Post.likes Int @default(0)` or similar (required column with default)
  - `@@index([authorId])` on `Post` (Prisma 8 must name it `Post_authorId_idx`)
  - A new model `Comment` with `postId Int` and `post Post @relation(fields: [postId], references: [id])` (foreign key `Comment_postId_fkey`, `ON DELETE RESTRICT ON UPDATE CASCADE` as Prisma 7 defaults), plus `id`, `body String`, `createdAt DateTime @default(now())`.
- **Edit 2 (destructive).** Drop `User.bio`, and change `Post.likes` to nullable or drop the `@@index`. At least one dropped column so the plan carries a destructive operation. Document how the user is expected to acknowledge the destructive plan (today: the plan is written as a file the user reviews; `db migrate` applies it).
- **Assert the plan, not the exit code.** Read the delta bundle's `migration.json` (or whatever the bundle carries) and assert the operation kinds and targets: add column ×2, create index, create table, add foreign key for edit 1; drop column (and the other change) for edit 2. Also read the rendered SQL and assert the index and foreign-key names and referential actions match what Prisma 7 would have written.
- **Both clients.** After `prisma7 generate`, a new script `scripts/v7-write-after-handover.ts` (name is the implementer's call) writes and reads the new columns and the new model through the Prisma 7 client. `src/main.ts` is extended so the Prisma 8 ORM reads the new column. After edit 2, the Prisma 7 client is regenerated and reads the surviving columns.
- **Loop twice.** Edit 2 goes through the same emit, plan, migrate, verify, generate, read steps, so the test proves the loop works more than once and that the second `migration plan` resolves `from` as the `db` ref written by the first `db migrate --advance-ref db`.
- **Docs.** Rewrite the "4. Transfer migration ownership" section of `examples/prisma7-adoption/README.md` to describe the run the test proves, with the exact commands. Fix the stale command names in `docs/architecture docs/subsystems/7. Migration System.md`: it says `prisma migrate` and `prisma ref set`; the code mounts `db migrate` and `migration ref set` (`packages/1-framework/3-tooling/cli/src/orm/family.ts`). Also fix its "Removed-verb redirects" row that points the wrong way, and the link to a nonexistent `utils/plan-resolution.ts`. Leave the public upgrade guide in prisma/web alone.

## Scope

In:
- The new test, its scripts, the `src/main.ts` extension, shared test helpers.
- Any defect that stops an additive or destructive change from planning, applying, verifying, or being read back by either client. Fix the cause, not the case.
- The README section and the Migration System doc command names.
- The upgrade-instructions coverage declaration if `examples/**` changes require one (`pnpm check:upgrade-coverage --mode pr --prev <base> --head HEAD`).

Deliberately out:
- Enum value removal, enum renames, `onDelete`/`onUpdate` changes, primary-key changes. The planner refuses these by design today.
- Making the contract describe `_prisma_migrations`. No "storage-only table" concept exists, and `tolerated` applies only to declared nodes. Needs a design decision first.
- Constraint-name divergence between Prisma 7 and Prisma 8 derivation (junction `_AB_pkey`, discarded `map:` names, 63-byte truncation): TML-3452. The chosen edits avoid touching those constraints.
- A notice for users who run `prisma7 migrate` after the handover.
- `orm init`.
- Changing `contract infer` advice.

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| Adding `autoincrement()` to an existing column | Planner silently emits no operation (`op-factory-call.ts`, `issue-planner.ts` column-default issue returns no calls). Not on the chosen path; do not include it in the edits. Report if hit. |
| Datasource `extensions` list | Ignored by the source and the planner never creates extensions. Not on the path. |
| Removing `@ignore` later | Plan would create a column that already exists because plans diff snapshot against contract, not the database. Not on the path. |
| Destructive plan consent | Only the auto-baseline leg asks for consent (`refuseUnconsentedDestructiveBaseline`). The non-interactive form is `--no-interactive --confirm <project-dir-name>`; `--yes` cannot grant it. A create-only baseline never asks. If the delta leg asks, treat it as new information and record it. |
| The strict-verify failure code | `combineVerifyResults` falls back to `CONTRACT.MARKER_REQUIRED` for an unclaimed-only failure. Misleading. Fix it if small and on the path; otherwise note it in the report. |
| CLI output mode | JSON when stdout is not a TTY; the test parses line-delimited JSON events and picks `kind === 'result'`. |
| First `prisma7` run | Fetches the schema engine once; CI already does this in its own step. |
| `Temporal` | The CLI process has no global `Temporal` on Node 24; #30520 fixed date and time defaults. A failure here is a regression. |

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] `pnpm --filter prisma7-adoption test` passes locally with both tests, and in CI.
- [ ] Every defect found on the path is fixed in the PR, or reported with evidence.
- [ ] The README phase 4 section documents the handover with the exact commands the test runs.
- [ ] Linear TML-3451 set to Done with a closing comment after merge.

## Dispatch plan

| # | Outcome | Builds on | Hands to |
|---|---|---|---|
| 1 | The handover test passes locally: both edits plan, apply, verify, and are read by both clients. On-path defects fixed with their own tests. | The existing adoption test and helpers. | A green `pnpm --filter prisma7-adoption test`; a list of defects fixed and off-path defects found. |
| 2 | Docs and CI gates: README phase 4 rewritten, Migration System doc names corrected, per-package lint, typecheck, upgrade coverage, and coverage thresholds for touched packages all pass. | Dispatch 1's green test and defect list. | Branch ready for `/drive-code-review`. |

## References

- `examples/prisma7-adoption/` (README, `test/adoption.test.ts`, `prisma/schema.prisma`, configs, `migrations/`).
- `projects/prisma7-contract-source/spec.md`, `slices/01-postgres-source/spec.md`, `slices/04-prisma7-adoption-example/spec.md`.
- `packages/1-framework/3-tooling/cli/src/orm/migration/plan.ts`, `control-api/operations/migration-plan.ts`, `control-api/operations/plan-resolution.ts`, `orm/migrate.ts`, `orm/db/verify.ts`, `orm/db/sign.ts`, `utils/combine-verify-results.ts`.
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts`, `default-constraint-names.ts`.
- `packages/2-sql/2-authoring/contract-prisma7/src/{indexes,relations,defaults}.ts`.
- `test/integration/test/cli-journeys/adopt-migrations.e2e.test.ts` and `test/integration/test/utils/journey-test-helpers.ts`.
- `docs/architecture docs/subsystems/7. Migration System.md`.
