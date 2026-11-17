# Slice plan — 4b, PR 1: top-level fields on MongoDB

**Spec:** [`spec.md`](./spec.md), PR 1 row · **Linear:** [TML-3538](https://linear.app/prisma-company/issue/TML-3538) · **Branch:** `tml-3538-mongo-value-object-statements`, from `origin/main` · **Worktree:** `wip/wt-4b`

PR 1 makes every MongoDB validator change check the documents first, turns type changes into questions answered by a cast, `--convert` or `--delete`, adds `--backfill`, and fills new required fields with a temporary value. Value objects, embedded models, enum values and variants wait for PR 2.

## Dispatches

| # | Outcome | Builds on | Hands to |
| --- | --- | --- | --- |
| 1 | `setValidation({ ..., checkDocuments: true })` fails the apply while any document does not fit the new validator, with a typed error naming the count, one `_id` and the query. Left out, nothing changes. The planner writes `checkDocuments: true` for every validator add and update | — | A validator change that proves the documents fit |
| 2 | A field type change the new validator rejects is a `typeChange` question. Casts that keep every value are planned with nothing asked. `--delete` casts with `$convert` and fails on a value MongoDB cannot cast, pointing to `--convert` | 1 | Type changes are asked about and answered by a cast |
| 3 | `--convert` and `--backfill` write a `dataTransform` whose check and filter the planner fills, whose run skips validation, and whose update is a placeholder. The rest of the plan still lists. `db update` refuses both | 2 | Scaffolds for top-level fields |
| 4 | `fillField` writes a temporary value, typed per codec, where a new required field is missing or `null`; reported in `temporaryValues`; refused under a unique index | 1 | New required fields filled without a question |
| 5 | The W1 warning; the no-origin type change wording; the journeys in `convert-backfill.mongo.e2e.test.ts` (C1 to C5, B1 to B4, W1); docs, ADR 188, the upgrade fragment and the Prisma 6 guide note | 2, 3, 4 | PR 1's done conditions |

Each dispatch has the persistent implementer, then the persistent reviewer. After dispatch 5: `/drive-code-review` without the walkthrough, fixes, manual QA, then the PR.

## Checks for every dispatch

- `pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in every touched package.
- `pnpm lint:deps`, `pnpm lint:ratchets` and `pnpm check:error-reference` pass.
- The MongoDB journeys that reach the changed commands pass, run by name: `rename-delete-statements.mongo`, `delete-statements-migration.mongo`, `value-object-validator.mongo`, `typescript-field-changes.mongo`, `mongo-db-update-consent`, `keep-documents-advice.mongo`, plus any file under `test/integration` that mentions mongo and the changed code.
