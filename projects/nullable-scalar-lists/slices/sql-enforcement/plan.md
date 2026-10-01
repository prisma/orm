# Slice: sql-enforcement — dispatch plan

**Spec:** [`spec.md`](./spec.md)

Two focused dispatches remain after the rebase; main already supplies the complete generated-check lifecycle.

## Dispatches

1. **`sql-psl-lowering`**
   - **Outcome:** SQL PSL resolution preserves `ResolvedField.elementNullable` for domain/build metadata and maps native nullable-element lists to storage `many: { elementNullable: true }` without an automatic `noCheck`. Explicit `Foo[] @noCheck(elementNotNull)` gets no marker; the same waiver on `Foo?[]` is rejected as inapplicable. Value-object lists keep domain metadata but JSONB storage receives neither marker nor waiver.
   - **Gate:** `@internal/sql-contract-psl` tests/typecheck/lint plus affected contract and TS-authoring builds.

2. **`rebase-validation`**
   - **Outcome:** `StorageColumn.many` is migrated to `false | { elementNullable: boolean }` across validation, hydration/serialization, factory, emitter, and TS type maps while `SqlColumnIR` remains without an element-nullability marker; Postgres generated-check tests confirm the marker suppresses `elementNotNull` generation before explicit `noCheck` filtering; project gates and fixtures remain clean.
   - **Builds on:** dispatch 1 and main's rewritten derivation/diff/introspection/infer lifecycle.
   - **Gate:** targeted parser/contract/SQL/Postgres tests, builds/typechecks/lints, `pnpm fixtures:check`, and `pnpm lint:deps`.

3. **`runtime-default-dispatch` — completed 2026-08-17**
   - **Outcome:** Confirmed SQL builder and ORM/query-builder paths stamp `CodecRef.many` and converge on the shared SQL runtime encode/decode loops. Null elements and whole-array null already bypass element codecs, so no `elementNullable` runtime metadata was added. Extended shared SQL contract default lowering so nullable null elements bypass `encodeJson`, strict null-containing defaults fail at authoring, and SQL PSL accepts `null` in list literals before applying the same semantic guard.
   - **Evidence:** `@internal/sql-runtime` 343 tests; `@internal/sql-contract-ts` 493 tests; `@internal/sql-contract-psl` 440 tests; all three package typechecks; PSL lint clean; targeted PGlite native-array integration 7 tests; `pnpm lint:deps`; `git diff --check`.
   - **Gate limitation:** `pnpm fixtures:check` could not start example emission because the workspace CLI artifact was absent (`MODULE_NOT_FOUND` for the `prisma-next` executable). The command-created Mongo diffs were removed. The broad Postgres adapter run reached 832 passing tests but had one unrelated 8-second timeout in `render-typescript.roundtrip.test.ts`; the targeted native-array file passed independently.

## Explicit exclusion

Do not touch the semantic `@prisma-next/psl-printer` / `PslField` path. Operator explicitly ruled it out of scope.
