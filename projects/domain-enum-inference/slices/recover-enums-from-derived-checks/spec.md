# Slice 2 — `recover-enums-from-derived-checks` — Spec

**Project:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md)

## Purpose

`contract infer` recovers a domain enum from a check constraint **Prisma Next itself created** (spec § Path A). A database migrated from a contract with `enumType()` round-trips: pull it and the enum block comes back, the column is typed by it, and the next `contract emit` re-derives the identical wire-named check — no `@@check`, no `@noCheck`, nothing pending on verify.

This is the first slice that emits an enum, so the naming policy, member derivation, codec-id mapping, and collision handling (project spec § Locked decisions 5–8) all land here. Slice 3 reuses them.

## Chosen design

### The harvest

A new helper (in `psl-infer/`) extracts candidate member values from a live check expression:

- collect the single-quoted string literals, **in order of appearance**;
- unescape doubled quotes (`'O''Brien'` → `O'Brien`);
- everything else — casts, parentheses, operators, `ANY`/`ARRAY`/`<@`/`IN`/`=` — is ignored, not matched.

It is a literal scan, not a parse: no predicate shape is recognized, per the project spec § The mechanism. Zero literals harvested means nothing recovered (Locked decision 1).

### Path A verification

For each table, for each live check whose name is wire-shaped (`parseWireName`) with prefix equal to `composeCheckWirePrefix(table, column, 'membership')` for some column of that table:

1. Harvest the check's expression. Empty harvest → not recovered; the check stays a plain `@@check` exactly as today.
2. Render the membership candidate through `postgresRenderCheckExpressions` with `memberValues` = the harvested list and `many` = `column.many === true`.
3. `formatWireName(prefix, computeCheckContentHash(candidate.expression))` and compare to the live constraint's **full name**. Equal → proven; the harvested list is exactly what some contract declared. Not equal → not recovered here; the check stays a plain `@@check` (slice 3's Path B will pick these up).

Both scalar and list columns are covered — the render helper already produces the `IN` and `<@` forms, and the reprint corpus pins both.

### Emission

A proven column yields:

- An `enum` extension block (keyword `enum`, the family descriptor) in the **top-level flat bucket** slice 1 built: name from `toEnumName(`${table}_${column}`)`, members as `<toEnumMemberName(value)> = "<value>"` pairs (member names deduplicated within the block via `createUniqueFieldName`, values JSON-encoded verbatim), and a `@@type("<codecId>")` block attribute where the codec id comes from the column's `nativeType` (`text` → `pg/text@1`, `varchar`/`character varying` → `pg/varchar@1`, `char`/`character` → `pg/char@1`). A native type outside that map recovers nothing — safe fallback, never an error.
- The column typed by the enum's PSL name (bare name, no type constructor — the authored form a domain-enum column takes), replacing the scalar type.
- **No `@@check` and no `@noCheck`**: the harvested values are threaded into `computeDerivedCheckNames` (replacing today's `memberValues: undefined`), so the live membership check lands in the derived set and the existing `@@check` exclusion and `@noCheck` waiver logic skip it with no new exclusion code. This is the mechanism the project spec § Structural work names.

### Where the recovery runs

Inside `buildPslDocumentAst`, not before it. The slice-1 `topLevelExtensionBlocks` parameter delivers a *declaration*, but a recovered column must also *reference* it, and `buildModel` types columns from `typeMap`/`enumNameMap` only — there is no per-column override. So `buildPslDocumentAst` grows the recovery step internally:

1. After model and native-enum names are allocated, walk `schemaIR.tables` and run Path A verification.
2. Allocate each recovered enum's PSL name against the claimed top-level scope (models, native enums, caller blocks, scalar type names) with `createUniqueFieldName` — the same numeric-suffix disambiguation `buildNativeEnumBlocks` uses.
3. Thread a per-table, per-column map of recovered enum names (and their member values) into `buildModel`/`buildScalarField` and into `computeDerivedCheckNames`.
4. Append the recovered blocks to the top-level extension blocks, so slice 1's bucket split applies unchanged.

The `topLevelExtensionBlocks` parameter and its collision throw stay for external callers; recovery allocates collision-free names upstream of it, so the throw is unreachable on the infer path.

### Collision policy: uniquify, never throw

Project spec Locked decision 6 and its DoD line ("Enum naming never throws") govern: a recovered enum whose derived name collides with a model, native enum, scalar type name, or another recovered block gets the numeric-suffix disambiguator. The handoff's open question ("throw or uniquify") is answered by the project spec — uniquify.

### The reserved scalar-name set is completed

`PSL_SCALAR_TYPE_NAMES` (nine framework names) is not the whole set of names that resolve as types in column position: the target contributes more (`Uuid`, `VarChar`, `Char`, `Numeric`, `SmallInt`, `Real`, `Date`, `Time`, `Timetz`, `Timestamp`, `Timestamptz`, `Inet`, `BigIntNumber`, `UnboundedInt`, …). A recovered enum named `Uuid` would silently retype every `Uuid` column — exactly the harm the guard exists to prevent. This slice derives the reserved set from the target's authoring types (`collectScalarTypeConstructors(postgresAuthoringTypes)` keys, or an equivalent single source that cannot drift from `postgres-type-map.ts`) merged with the framework names, and the export becomes `ReadonlySet<string>`.

## Coherence rationale

One reviewer sitting: the harvest helper, the verification loop, the emission threading, and the naming policy are one mechanism — each is meaningless without the others, and together they are one PR-sized diff over `psl-infer/` plus tests. Path B (slice 3) is deliberately excluded; it reuses this machinery but adds its own waiver and verbatim-`@@check` emission.

## Scope

**In:**

- The harvest helper + unit tests over every corpus shape (`packages/3-targets/6-adapters/postgres/test/migrations/check-introspection.integration.test.ts` pins the literals: text one/many, varchar one/many, `<@` array, doubled-quote member).
- Path A verification, emission, per-column threading, `computeDerivedCheckNames` member-value threading, in `buildPslDocumentAst` internals.
- Naming/collision policy incl. the completed scalar-name reserve set.
- Unit tests at the `inferPostgresPslContract` level (tree fixtures, live check names computed with the real naming helpers — never hand-spelled hashes).
- The negative case: a wire-*shaped* name whose hash does not verify (the existing `t_role_check_0a1b2c3d` fixture shape) recovers nothing and its `@@check` still emits.
- Round-trip integration proof: emit a contract with `enumType()` → migrate a real database → infer → the enum block, member order, and typed column come back, and verify is clean with no pending operations (extend `infer-roundtrip-fidelity.e2e.test.ts` or the adapter integration suite — whichever already exercises this loop).
- Recovery coexists with a native enum or RLS policy on the same database: recovered enum prints top-level, the rest wraps (slice 1's seam, now carrying a real payload).

**Out:**

- Path B / adopted checks, `@noCheck(membership)` on scalar columns, the containment rule, and the verbatim `@@check(map:)` pairing — slice 3.
- The Supabase generator's second-bucket drop and its target-only descriptors (handoff hazards 3–4): its reference fixture's membership checks are hand-written exact names, which Path A never recovers, so those defects cannot fire in this slice. They are slice 3's to fix.
- Merging identical value sets, recovering member names, native-enum inference changes (project non-goals).
- The `__unspecified__`-named live schema quirk and the cross-namespace model-ordering defect (handoff item 8) — pre-existing, orthogonal.

## Pre-investigated edge cases

| Case | Behaviour |
| --- | --- |
| One-member check (`(role = 'user'::text)` reprint) | Harvest `['user']`, re-render `"role" IN ('user')` — hashes match the authored form because the hash was computed over the authored render, not the reprint. |
| Doubled-quote member (`'O''Brien'`) | Unescape on harvest; `escapeLiteral` re-doubles on render; hash matches. |
| Wire-shaped name, wrong hash (`t_role_check_0a1b2c3d`) | Not recovered; `@@check` emits as today. |
| Wrong member order in harvest | Different render → different hash → not recovered. Order-sensitivity is the proof working as designed. |
| `elementNotNull` wire-named check | Kind suffix `elem_not_null` never matches a membership prefix; ignored by recovery, still skipped from `@@check` by the existing derived-name logic. |
| Column nativeType with no codec mapping (e.g. a membership check on `citext`) | Not recovered; plain `@@check`. |
| Recovered name collides with model/native enum/scalar/another recovery | Numeric suffix; never a throw. |
| Test print sites lacking the family `enum` descriptor (handoff hazard 6) | Only fires if a fixture recovers — i.e. carries a correctly-hashed wire name. Any test this slice adds that prints must pass descriptors that include `sqlFamilyPslBlockDescriptors`' `enum`; existing fixtures cannot trip it by accident. |
| Positional `namespaces[0]` assertions (handoff hazard 7) | The split changes bucket order only when recovery fires under a wrap. New tests assert buckets **by name**, and any existing assertion a new fixture affects is updated to name-based in the same diff. |

## Slice-specific done conditions

- The round-trip DoD line from the project spec holds: emit → migrate → infer returns the same enum, same member order, and a contract that verifies clean with no pending operations.
- Every existing `contract infer` output without a verified membership check is byte-identical to before.

## Open questions

None — the throw-vs-uniquify question the handoff left open is settled by project spec Locked decision 6.

## References

- Project spec § Path A, § Locked decisions, § Structural work: [`../../spec.md`](../../spec.md)
- Reprint corpus: `packages/3-targets/6-adapters/postgres/test/migrations/check-introspection.integration.test.ts`
- Naming helpers: `packages/2-sql/1-core/schema-ir/src/naming.ts` (`composeCheckWirePrefix`, `computeCheckContentHash`, `formatWireName`, `parseWireName`)
- Render helper: `packages/3-targets/3-targets/postgres/src/core/check-expressions.ts`
- Emission seam: `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-psl-contract.ts` (`buildPslDocumentAst`), `infer-model-blocks.ts`, `infer-enum-blocks.ts`
- Family `enum` block/descriptor: `packages/2-sql/9-family/src/core/authoring-entity-types.ts`
