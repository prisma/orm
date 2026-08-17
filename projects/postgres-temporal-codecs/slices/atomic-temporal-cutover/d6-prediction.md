# What must go quiet when the old temporal codecs are deleted

A prediction, written before the deletion, so that the deletion becomes a claim someone can falsify
rather than a change that is merely green afterwards. If the dispatch that removes the codecs finds
a consumer that is not on this list, or finds one on this list that turns out not to need touching,
the difference is worth understanding — it means something was reaching those codecs by a route
nobody had accounted for.

Written by the dispatch that repointed authoring. Everything below was obtained with `rg` against
the tree as it stands after that repoint, not from memory:

```
rg -F -e 'sql/timestamp@1' -e 'pg/date@1' -e 'pg/timestamp@1' -e 'pg/timestamptz@1' \
      -e 'pg/time@1' -l --glob '!node_modules/**' --glob '!**/dist/**' --glob '!projects/**'
```

**253 files still name one of the five retiring ids.** They are not one job. The point of the split
below is that only the first two groups are the deleting dispatch's work at all.

## The headline: nothing authors them any more

Zero files under any authoring surface appear below. Before this dispatch, nine sites across
`3-targets/postgres/src/core/authoring.ts` and `6-adapters/postgres/src/core/control-mutation-defaults.ts`
named the retiring ids; all nine now name a representation-explicit codec. **No PSL spelling, no
TypeScript field preset, and no scalar-type constructor can produce one of these ids.** Every
remaining reference is a definition, a description, a test, a generated artefact, or a historical
record.

That is the property that makes the deletion safe to attempt: what is left cannot grow.

## Group 1 — definitions to remove (3 files)

The codecs themselves. These are the deletion.

- `packages/3-targets/3-targets/postgres/src/core/codec-ids.ts` — the four `PG_*_CODEC_ID`
  constants for `date` / `timestamp` / `timestamptz` / `time`.
- `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts` — the Date-typed
  encode/decode/JSON helpers those codecs compose with. Note `timetz` and `interval` share this
  file and must keep working.
- `packages/2-sql/4-lanes/relational-core/src/ast/sql-codec-helpers.ts` — `SQL_TIMESTAMP_CODEC_ID`
  and the `sql/timestamp@1` helpers.

The codec classes, descriptors, column helpers and registrations in
`3-targets/postgres/src/core/codecs.ts` go with them; that file does not appear in the `rg` output
because it names the ids only through the imported constants.

## Group 2 — one real consumer, and five prose mentions

Exactly one file outside the definitions still *uses* a retiring id:

- `packages/3-extensions/supabase/src/contract/handles.ts:16` —
  `const pgTimestamptz = { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' }`. A hand-written
  contract handle, not generated. It has to be repointed, and choosing which representation Supabase's
  timestamps get is a decision rather than a rename.

The other five name a retiring id only inside a doc comment, as an illustrative example:

- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:456`
- `packages/1-framework/1-core/framework-components/src/shared/codec.ts:40`
- `packages/2-sql/4-lanes/relational-core/src/expression.ts:126`
- `packages/2-sql/5-runtime/src/sql-context.ts:420`
- `packages/2-sql/9-family/src/core/timestamp-now-generator.ts:136`

Leaving these is harmless to behaviour and corrosive to documentation — each would then cite a codec
that does not exist. Cheap to fix, and they are the reason the `rg` count will not reach zero by
deleting code alone.

## Group 3 — 55 test files

Enumerated in full at the end. They divide by intent, and the division matters more than the count:

- Tests **of** the retiring codecs — the encode/decode/JSON/render suites in
  `3-targets/postgres/test/` and the `sql/timestamp@1` suites in `relational-core/test/`. These are
  deleted with their subjects.
- Tests that merely **use** a temporal codec as a convenient scalar — fixtures and helpers such as
  `packages/2-sql/5-runtime/test/utils.ts`, `test/utils/src/column-descriptors.ts`,
  `packages/2-sql/9-family/test/schema-verify.helpers.ts`. These are repointed, not deleted.
- **Inventory and conformance** lists that must lose four entries each: the canonical codec-id order
  in `3-targets/postgres/test/postgres-built-in-codec-descriptors.test.ts`, and the testkit's
  `aggregate-matrix.ts` and `codec-conformance/cases.ts`.

Two of those testkit entries are the transient `notYetCanonical` markers on `pg/timestamptz@1`,
which record that they resolve when the codec is retired. **Deleting the codec is what resolves
them**; they should disappear with the cases rather than be edited.

## Group 4 — 178 generated artefacts, which are not this dispatch's work

`contract.json`, `contract.d.ts`, `expected.contract.json` and migration snapshots — 130 of them
under `test/integration`, the rest across `examples/`, `packages/3-extensions/` and `apps/`. They
drift the moment authoring repoints and are regenerated wholesale by the fixture sweep. Hand-editing
any of them is a mistake; if the sweep leaves drift outside the temporal surface, that is a finding
rather than something to commit.

## Group 5 — 11 historical records that must NOT be rewritten

- `CHANGELOG.md`, `docs/releases/v0.17.0.md`
- `ROADMAP.md`, `ROADMAP.html`
- `docs/architecture docs/adrs/ADR 184 - Codec-owned value serialization.md`
- `docs/architecture docs/adrs/ADR 246 - Option arguments and select templates for authoring helpers.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/reference/typescript-patterns.md`
- `skills/prisma-next-upgrade/upgrades/0.16-to-0.17/instructions.md`
- `skills/prisma-8-extension-upgrade/upgrades/0.16-to-0.17/instructions.md`
- `skills/prisma-8-extension-upgrade/upgrades/0.14-to-0.15/instructions.md`

Release notes and upgrade instructions describe versions that shipped with these codecs. They are
accurate statements about the past and editing them would make them false. The two subsystem/pattern
docs and the two ADRs use a retiring id as an example; whether to refresh those examples is a
documentation judgment, not part of the deletion.

## How to read a mismatch

- **A consumer not on this list** — something reached the codecs by a route the `rg` did not cover.
  Most likely a string built at runtime, or a re-export that renames the constant.
- **A listed file that needs no change** — most likely a test already deleted alongside its subject,
  or a doc comment someone refreshed in between.
- **The count not reaching zero** — expected. Groups 4 and 5 are not the deleting dispatch's, and
  the count only falls to zero after the fixture sweep, and then only outside the historical records.

### source (9)
- `packages/1-framework/1-core/framework-components/src/control/control-stack.ts`
- `packages/1-framework/1-core/framework-components/src/shared/codec.ts`
- `packages/2-sql/4-lanes/relational-core/src/ast/sql-codec-helpers.ts`
- `packages/2-sql/4-lanes/relational-core/src/expression.ts`
- `packages/2-sql/5-runtime/src/sql-context.ts`
- `packages/2-sql/9-family/src/core/timestamp-now-generator.ts`
- `packages/3-extensions/supabase/src/contract/handles.ts`
- `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`
- `packages/3-targets/3-targets/postgres/src/core/codec-ids.ts`

### tests (55)
- `packages/1-framework/3-tooling/emitter/test/canonicalization.test.ts`
- `packages/2-sql/2-authoring/contract-psl/test/fixtures.ts`
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.test.ts`
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.types.test.ts`
- `packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/authoring-helper-runtime.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/contract-builder.contract-definition.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/contract-builder.dsl.helpers.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/contract-builder.dsl.portability.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/contract-builder.dsl.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/contract.logic.test.ts`
- `packages/2-sql/2-authoring/contract-ts/test/temporal-preset-mirror.ts`
- `packages/2-sql/4-lanes/relational-core/test/ast/sql-codec-helpers.test.ts`
- `packages/2-sql/4-lanes/relational-core/test/ast/sql-codecs.test.ts`
- `packages/2-sql/4-lanes/relational-core/test/contract-free/table.test.ts`
- `packages/2-sql/4-lanes/relational-core/test/structured-errors.test.ts`
- `packages/2-sql/5-runtime/test/utils.ts`
- `packages/2-sql/9-family/test/schema-verify.helpers.ts`
- `packages/2-sql/9-family/test/temporal-codec-presets.test-d.ts`
- `packages/2-sql/9-family/test/temporal-codec-presets.test.ts`
- `packages/3-extensions/pgvector/test/migrations/planner.contract-to-schema-ir.test.ts`
- `packages/3-extensions/pgvector/test/rich-adapter.test.ts`
- `packages/3-extensions/postgres/test/raw-sql-composition.test.ts`
- `packages/3-targets/3-targets/postgres/test/codec-render-output-type.test.ts`
- `packages/3-targets/3-targets/postgres/test/codec-render-value-literal.test.ts`
- `packages/3-targets/3-targets/postgres/test/codecs-class.test.ts`
- `packages/3-targets/3-targets/postgres/test/codecs-runtime-and-helpers.test.ts`
- `packages/3-targets/3-targets/postgres/test/codecs.test.ts`
- `packages/3-targets/3-targets/postgres/test/contract-free/columns.test.ts`
- `packages/3-targets/3-targets/postgres/test/errors.test.ts`
- `packages/3-targets/3-targets/postgres/test/migrations/planner-sql-checks.test.ts`
- `packages/3-targets/3-targets/postgres/test/postgres-built-in-codec-descriptors.test.ts`
- `packages/3-targets/3-targets/postgres/test/psl-infer/infer-parse-emit.test.ts`
- `packages/3-targets/3-targets/postgres/test/psl-policy-authoring.test.ts`
- `packages/3-targets/6-adapters/postgres-codec-testkit/test/aggregate-matrix.ts`
- `packages/3-targets/6-adapters/postgres-codec-testkit/test/codec-conformance/cases.ts`
- `packages/3-targets/6-adapters/postgres/test/adapter.test.ts`
- `packages/3-targets/6-adapters/postgres/test/descriptor-meta.test.ts`
- `packages/3-targets/6-adapters/postgres/test/migrations/planner.reconciliation.integration.test.ts`
- `packages/3-targets/6-adapters/postgres/test/migrations/schema-verify.after-runner.integration.test.ts`
- `packages/3-targets/6-adapters/postgres/test/raw-expr-lowering.test.ts`
- `packages/3-targets/6-adapters/postgres/test/scalar-list-codec-roundtrip.integration.test.ts`
- `test/integration/test/contract-builder.test.ts`
- `test/integration/test/contract-builder.types.test-d.ts`
- `test/integration/test/contract-imports.test.ts`
- `test/integration/test/family.schema-verify.dependencies.integration.test.ts`
- `test/integration/test/family.schema-verify.types.test.ts`
- `test/integration/test/infer-roundtrip-runtime.integration.test.ts`
- `test/integration/test/ports/prisma/failing.md`
- `test/integration/test/ports/prisma/functional/issues-14954-date-batch/issues-14954-date-batch.test.ts`
- `test/integration/test/ports/prisma/functional/issues-28192-pg-historical-dates/issues-28192-pg-historical-dates.test.ts`
- `test/integration/test/ports/prisma/functional/issues-29309-datetime-cursor/_fixture/contract.prisma`
- `test/integration/test/ports/prisma/functional/issues-29309-datetime-cursor/issues-29309-datetime-cursor.test.ts`
- `test/integration/test/scalar-lists/psl-list-roundtrip.integration.test.ts`
- `test/utils/src/column-descriptors.ts`
