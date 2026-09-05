# Slice 2 — `recover-enums-from-derived-checks` — Dispatch plan

**Spec:** [`./spec.md`](./spec.md)

Three sequential dispatches.

## Dispatch 1 — harvest helper

- **Outcome:** a literal-harvest helper exists in `packages/3-targets/3-targets/postgres/src/core/psl-infer/` that extracts single-quoted literals in order (doubled quotes unescaped, everything else ignored) from a check expression, with unit tests covering every pinned reprint corpus shape plus empty/no-literal predicates.
- **Builds on:** slice 1's captured corpus (`check-introspection.integration.test.ts`).
- **Hands to:** dispatch 2 — a proven extractor whose output feeds Path A verification.
- **Focus:** the helper is a text scan, never a predicate parser. Test literals are the corpus's captured strings verbatim.
- **Gate:** `cd packages/3-targets/3-targets/postgres && pnpm test` (package suite), `pnpm typecheck`.

## Dispatch 2 — Path A recovery and emission

- **Outcome:** `inferPostgresPslContract` recovers a hash-verified domain enum: the enum block prints top-level, the column is typed by it, no `@@check`/`@noCheck` emits for the proven constraint, names uniquify (never throw), and the reserved scalar-name set covers the target's contributed type names.
- **Builds on:** dispatch 1's harvest helper.
- **Hands to:** dispatch 3 — recovery machinery complete at the unit level.
- **Focus:** recovery runs inside `buildPslDocumentAst` (per-column threading into `buildModel`/`buildScalarField`, member values into `computeDerivedCheckNames`). Live check names in test fixtures are computed with the real naming helpers, never hand-spelled. Negative cases: wire-shaped fake hash, empty harvest, unmapped native type, `elementNotNull` names. Byte-identical output for inputs without a verified membership check.
- **Gate:** package suite + `pnpm build` + `pnpm typecheck` + package `lint` + `pnpm lint:deps` + `node scripts/lint-casts.mjs` (delta 0).

## Dispatch 3 — round-trip proof

- **Outcome:** an integration/e2e test proves emit → migrate → infer returns the same enum, same member order, and a contract that verifies clean with no pending operations; recovery coexists with a native enum or RLS policy (top-level enum + wrapped rest); any positional `namespaces[0]` assertion a new fixture affects is rewritten name-based.
- **Builds on:** dispatch 2.
- **Hands to:** slice DoD; PR-open.
- **Focus:** extend `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` or the `packages/3-targets/6-adapters/postgres` integration suite — whichever already drives this loop. Watch for print sites lacking the family `enum` descriptor (spec § edge cases).
- **Gate:** the touched integration suites + full DoD floor (`pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm install && pnpm fixtures:check` with the double-install gotcha, cast ratchet).

## Open items

- Handoff hazards 3, 4 (Supabase generator), and the remaining hazard-6 print sites that only Path B can trip: deferred to slice 3 per spec § Out.
