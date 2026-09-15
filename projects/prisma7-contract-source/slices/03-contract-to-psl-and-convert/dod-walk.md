# Slice 3 Definition of Done walk — 2026-09-15

Walked by the orchestrator against the slice spec's checklist and the team overlay in `drive/calibration/dod.md`. Reviewer verdict on the code: SATISFIED after five rounds across dispatches 1, 1b, 2, 3, 4 (findings S3-1 to S3-15, all closed). Tip at the walk: `727a509cfc` (after merging the PR 30287 review-thread fixes; corpus 20 cases, all fifteen gates exit 0). PR https://github.com/prisma/orm/pull/30300.

## Slice-specific items (slice spec)

- ✓ Round trip (three hashes and the domain plane) for every corpus fixture with an `expected-contract.json` (18 cases) and for `supported-verify` and `relations`: `test/integration/test/prisma7-source/printer-round-trip.integration.test.ts`, 22 tests, plus the hand-written spelling test `prisma8-spelling.integration.test.ts`.
- ✓ The printed `supported-verify` output emits with the PSL source and `db verify` reports zero findings: the spelling test (hand-written file, verified against `supported/migration.sql`) and the printer round trip (printed text yields the identical contract).
- ✓ CLI README documents `contract convert` in the guide's phase 4 and 5 order; `contract-prisma7` README and the Postgres facade README describe cutover; `examples/prisma7-adoption` runs convert, config switch, emit, verify, `migration plan --name baseline`, `db sign`, `migration ref set` in its test.
- ✓ `--json` carries `psl.path` (`contract-convert.test.ts`).

## Team overlay, plan-side

- ✓ `pnpm build`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:framework-vocabulary` (307 = 307), `pnpm lint:throws` (delta 0), `pnpm lint:casts` (delta 0), `pnpm test:packages` (16179 passed; five tarball tests fail on the unpublished `@prisma/cli-engine@0.4.0`, environment), `pnpm test:integration` (384 files, 2120 passed), `pnpm fixtures:check` clean, `check:upgrade-coverage --prev prisma7-contract-source` exit 0, `check:error-reference` passes, root typecheck exit 0.

## Team overlay, PR-side

- ✗ Linear issue and ticket-prefixed title: the operator excluded Linear from this project.
- ✓ No `projects/` references in long-lived files this slice touched.
- ✓ Upgrade entries: two app entries (`json-default-literal-is-json-text`, `scalar-list-fields-keep-type-params`) in `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.11-to-8.0.0-rc.12/`; extension diff is README-only, `changes: []` stands.
- ✓ Stacked on `prisma7-contract-source` (PR 30287); base retargets to `main` when that merges.

## Team overlay, QA-side

- ✓ README-only QA run of `prisma contract convert` per `manual-qa-slice-03.md`; report `manual-qa-reports/2026-09-15-qa-runner-convert.md`: no blockers, three should-fix findings and six notes, all fixed with regression tests or documented in dispatch 5, re-run section green.

## Dispatch DoD overlay

- ✓ Every feature red-then-green; no parser or interpreter check relaxed (one orchestrator ruling reversed on review, S3-11, recorded in the ledger); no destructive git operations; fixture regenerations limited to the four interpreter features' intended effects plus the new corpus case.
