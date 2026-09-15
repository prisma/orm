# Slice 3: contract-to-PSL printer and `prisma contract convert` — Dispatch plan

**Spec:** `projects/prisma7-contract-source/slices/03-contract-to-psl-and-convert/spec.md`
**Branch:** `prisma7-contract-convert`, stacked on `prisma7-contract-source` (PR https://github.com/prisma/orm/pull/30287); the PR targets that branch until 30287 merges, then `main`.

Six dispatches (1, 1b, 2, 3, 4, 5), sequential, test-first. Dispatch 1 proves by hand that every construct the Prisma 7 source produces has a Prisma 8 spelling before any printer code exists; its hand-written file is the shape the printer must reach. Briefs are numbered files under `dispatches/`.

Calibration threaded into every brief: `drive/calibration/failure-modes.md` F3, F13, F14, F16, F24, F28; `drive/calibration/grep-library.md` cross-cutting anti-patterns; operator rules in `projects/prisma7-contract-source/design-notes.md` § Principles.

### Dispatch 1: hand-written Prisma 8 spelling of the supported fixture

- **Outcome:** A committed Prisma 8 `contract.prisma`, written by hand for `test/integration/test/fixtures/prisma7-source/supported-verify/schema.prisma`, interprets through the PSL source to a contract whose three hashes and domain plane equal the Prisma 7 source's, and `db verify` reports zero findings against `supported/migration.sql`.
- **Builds on:** slice 1.
- **Hands to:** the exact spelling of every construct (the printing-rules table, confirmed or corrected), and the round-trip assertion helper the later dispatches reuse.
- **Focus:** one integration test beside `supported.integration.test.ts`; the fixture at `test/integration/test/fixtures/prisma7-source/supported-verify/contract.prisma` with a README line. Risk areas to settle first: named and self-referential implicit many-to-many pairing through the junction (`Favorites`, `Follows`), enum handle and `@@map`, `temporal.timestamptz(6, onCreate: now, onUpdate: now)`.
- **Halt:** any construct with no spelling. Report it as a feature to build; do not touch the PSL interpreter's checks.

### Dispatch 1b: PSL interpreter features the round trip needs

_Added 2026-09-14 after dispatch 1 halted on three constructs with no Prisma 8 spelling and one domain-plane difference._

- **Outcome:** The Prisma 8 PSL interpreter treats a column-list unique index as making a back-relation one-to-one, keeps `BigInt` literal defaults exact, reads string literal defaults on JSON columns as JSON text, and keeps `typeParams` on scalar list fields; the hand-written file from dispatch 1 round-trips with no substitutions.
- **Builds on:** dispatch 1.
- **Hands to:** dispatch 2's target spelling, now complete.
- **Focus:** `packages/2-sql/2-authoring/contract-psl`, test-first per feature.

### Dispatch 2: the Postgres contract-to-PSL printer

- **Outcome:** A `printPslContract` hook (framework capability, SQL descriptor hook, family instance dispatch, Postgres implementation, CLI control client, fixture-client double) returns a `PslDocumentAst` for any Postgres contract, and for every Prisma 7 fixture the printed text round-trips per the spec. `printPsl` gains the header option; infer's wording is unchanged.
- **Builds on:** dispatch 1.
- **Hands to:** the hook the command calls.
- **Focus:** `packages/3-targets/3-targets/postgres/src/core/psl-print/` mirroring `psl-infer/`, reusing its AST literal helpers and the default mapping table; unit tests in the Postgres target package driven by the `contract-prisma7` fixture corpus through the real control stack (as `contract-prisma7/test/support.ts` does).

### Dispatch 3: `prisma contract convert`

- **Outcome:** The command exists, refuses non-Prisma 7 sources, writes the converted file with the header, reports the path under `--json`, and an e2e journey converts the fixture app, switches its config to the PSL source, emits, and verifies with zero findings.
- **Builds on:** dispatch 2.
- **Hands to:** the user-facing cutover step.
- **Focus:** `cli/src/orm/contract/convert.ts` from `infer.ts`; the contract loading shared with `contract-emit.ts`; unit tests with injected doubles; `test/integration/test/cli-journeys/prisma7-source.e2e.test.ts` gains the cutover journey.

### Dispatch 4: docs, example cutover, closing gates

- **Outcome:** CLI README documents the command; the Prisma 7 source README and the Postgres extension README describe cutover in phase 4 terms; `examples/prisma7-adoption` runs `contract convert` and the phase 4 steps in its test and README; repo-wide gates green; PR open.
- **Builds on:** dispatch 3.
- **Hands to:** slice DoD; a README-only QA run.


### Dispatch 5: manual QA fixes

_Added 2026-09-15 after the README-only QA run (`manual-qa-reports/2026-09-15-qa-runner-convert.md`): no blockers; three should-fix findings in human output around the cutover, six notes._

- **Outcome:** every QA finding fixed with a regression test or documented, with a re-run of the affected steps.
- **Builds on:** dispatch 4.
- **Hands to:** slice DoD; PR.

## Handoff completeness

Dispatch 1 proves spellability and supplies the round-trip helper. Dispatch 2 reaches the first DoD item. Dispatch 3 reaches the second and fourth. Dispatch 4 the third. Together they reach every slice DoD item.
