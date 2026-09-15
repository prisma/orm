# Prisma 7 contract source and converter — Plan

**Spec:** `projects/prisma7-contract-source/spec.md`
**Tracker:** none; the operator decided Linear is not needed for this project. **PR for slices 1 and 4:** https://github.com/prisma/orm/pull/30287. **PR for slice 3:** https://github.com/prisma/orm/pull/30300 (base `prisma7-contract-source`; retarget to `main` when 30287 merges).

## At a glance

One stack of three slices. Slice 1 lands the parser additions, the config change, and the Postgres source with its end-to-end proof. Slice 2 reuses the parser additions for Mongo. Slice 3 adds the contract-to-PSL printer and the convert command, whose round-trip test consumes the fixtures of both sources. Slice 3's Postgres half can start as soon as slice 1 merges.

## Composition

### Stack (deliver in order)

1. **Slice `01-postgres-source`** — Linear: TML-____ — **built and reviewed; PR https://github.com/prisma/orm/pull/30287**
   - **Outcome:** A Postgres project configured with `prisma7Schema('prisma/schema.prisma')` emits, signs, and verifies with zero findings against the database Prisma 7 built.
   - **Builds on:** nothing.
   - **Hands to:** (a) parser grammar that reads Prisma 7 enum member attributes and `view` blocks; (b) `defineConfig({ contract: ContractConfig })` accepted by the Postgres extension; (c) the `prisma7Schema` factory shape and `source.load` contract; (d) relation pairing decoupled from `FieldSymbol`; (e) a fixture corpus with a schema plus the SQL Prisma 7 generated for it.
   - **Focus:** `packages/1-framework/2-authoring/psl-parser` (grammar), new `packages/2-sql/2-authoring/contract-prisma7`, `packages/3-extensions/postgres/src/config/define-config.ts`, `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts` (decoupling only). Verification items 1, 2, 3, 4, 6 from the spec are the first dispatches.

2. **Slice `02-mongo-source`** — Linear: TML-____
   - **Outcome:** A Mongo project configured with `prisma7Schema(...)` emits and signs against collections shaped by Prisma 7.
   - **Builds on:** slice 1's parser grammar and factory shape.
   - **Hands to:** the Mongo fixture corpus for slice 3's round trip.
   - **Focus:** new `packages/2-mongo-family/2-authoring/contract-prisma7`, `packages/3-extensions/mongo/src/config/define-config.ts`. Verification item 5 first. Also the Mongo contract-to-PSL printer hook (moved here from slice 3 on 2026-09-14: it needs the Mongo source and fixtures).

3. **Slice `03-contract-to-psl-and-convert`** — built, reviewed, QA run; **PR https://github.com/prisma/orm/pull/30300** (stacked on 30287)
   - **Outcome:** `prisma contract convert` writes a Prisma 8 `contract.prisma` whose contract hashes equal the Prisma 7 source's, for every fixture of both families.
   - **Builds on:** slices 1 and 2 (fixtures and contracts). The Postgres printer may begin after slice 1 alone.
   - **Hands to:** the cutover path; project close-out.
   - **Focus:** a contract-to-PSL hook on the Postgres and Mongo target descriptors, `packages/1-framework/3-tooling/cli/src/orm/contract/convert.ts`, CLI README.

4. **Slice `04-prisma7-adoption-example`** — Linear: TML-____ (added 2026-09-14 at the operator's request) — **built and reviewed; ships in PR 30287**
   - **Outcome:** `examples/prisma7-adoption` shows a Prisma 7 project migrating on Prisma 7 while Prisma 8 adopts, signs, verifies, and queries the same database through `prisma7Schema`; its test runs the whole story in CI.
   - **Builds on:** slice 1.
   - **Hands to:** the worked example the upgrade guide's phase 2 can point at instead of `contract infer` plus hand edits.
   - **Focus:** `examples/prisma7-adoption` following the public guide (`@prisma/prisma7`, `prisma7` binary, `prisma7.config.ts`; Prisma 8 from the workspace), CI wiring, workspace policy entries for the Prisma 7 packages if needed. Runs in parallel with slices 2 and 3.

## Dependencies (external)

- None. The parser and the contract-source extension point already exist on `main`.

## Sequencing rationale

Slice 2 needs the enum-member grammar and the factory shape from slice 1, and duplicating them would produce a merge conflict on the parser. Slice 3 needs finished contracts to print and fixtures to round-trip. The three slices touch disjoint packages otherwise, so slice 3's Postgres half can overlap with slice 2.

## Model tiers

Implementer dispatches: Fable. Reviewer dispatches: Opus 4.8, mid effort. Set by the operator.

## Close-out (required)

- [ ] Verify every project DoD item in `spec.md`.
- [ ] Write the ADR named in `spec.md` § ADR pointer into `docs/architecture docs/adrs/`.
- [ ] Migrate the user-facing transition and cutover instructions into `docs/`.
- [ ] Strip repo-wide references to `projects/prisma7-contract-source/**`.
- [ ] Delete `projects/prisma7-contract-source/`.
