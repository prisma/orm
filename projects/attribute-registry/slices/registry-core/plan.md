# registry-core — Dispatch plan

**Spec:** [`./spec.md`](./spec.md) · **Linear:** [TML-3227](https://linear.app/prisma-company/issue/TML-3227)

Sequence: contribution surface (core) → plain-data assembly (psl-parser) → the ADR-236 factory flip (contributor + consumer atomically) → LSP-consumability proof + slice gates. Sandwich-shaped; each dispatch is a stable state the next builds on.

## Dispatch plan

### Dispatch 1: attribute-specs-contribution-key

- **Outcome:** `AuthoringContributions.attributeSpecs` (optional; `{ model, field }` records of erased factories) transits core and assembles: `AssembledAuthoringContributions.attributeSpecs` is required, `assembleAuthoringContributions` merges it across descriptors with duplicate-name-per-level as an assembly error, and the structural-validation walker accepts/validates the new key. Doc comment on `AuthoringModelAttributeDescriptor.spec` re-contracted to "spec factory over the uniform ctx" (text only; shape change lands in dispatch 3).
- **Builds on:** the spec's chosen design §2.
- **Hands to:** a core contribution + assembly surface that `createAttributeRegistry` can consume; empty namespaces assemble today (no family registers yet).
- **Focus:** `@internal/framework-components` only (`framework-authoring.ts`, `control/control-stack.ts`, exports, tests near `control-stack.model-attributes.test.ts`). No psl-parser, no consumers.
- **Model tier:** opus (substrate change). **Gates:** `cd packages/1-framework/1-core/framework-components && pnpm typecheck` (incl. test project) · `pnpm --filter @internal/framework-components lint` · `pnpm --filter @internal/framework-components test`.

### Dispatch 2: assemble-attribute-specs

- **Outcome:** `@internal/psl-parser` exports the uniform ctx (`AttributeSpecContext` / `FieldAttributeSpecContext`), factory types, `AttributeSpecNamespace`, and `assembleAttributeSpecs` returning `AssembledAttributeSpecs` — frozen plain data (`{ model, field }` records), **no interface, no accessor methods** (design-decisions § 9) — whose single documented `blindCast` narrows erased entries; the model record merges `attributeSpecs.model` with `modelAttributes` descriptors' `spec` factories (cross-source name collision errors), the field record reads `attributeSpecs.field`; tests cover assembly, enumeration, merge, and collision.
- **Builds on:** Dispatch 1's assembled `attributeSpecs` surface.
- **Hands to:** the plain-data assembled view the LSP test (dispatch 4) and later unknown-name diagnostics consume; the factory types the ADR-236 flip (dispatch 3) types against. Interpreters keep consuming their own `const` namespaces — never this view.
- **Focus:** `@internal/psl-parser` only (`src/attribute-spec/`, barrel `src/exports/index.ts`, tests). Assembly treats descriptor `spec` as factory by contract even though postgres flips in dispatch 3 — no consumer invokes postgres's entry until then. Block attributes stay on descriptors (slice `block-attributes-on-kit`).
- **Model tier:** opus (design judgment: typed view + the one narrow). **Gates:** `cd packages/1-framework/2-authoring/psl-parser && pnpm typecheck` · `pnpm --filter @internal/psl-parser lint` · `pnpm --filter @internal/psl-parser test` · `pnpm lint:deps`.

### Dispatch 3: adr-236-factory-flip

- **Outcome:** the descriptor `spec` contract is the factory shape everywhere it ships: postgres `@@rls` supplies a factory (`authoring.ts:650–663`), the SQL contributed-attribute loop (`interpreter.ts:1060–1122`) narrows to `ModelAttributeSpecFactory` and invokes it with a ctx built from the symbol table, current `ModelSymbol`, and the default-function registry (threading any missing fact to that site additively), and ADR 236's sample + prose (`:39,69,72`) describe the factory shape. Emitted contracts unchanged.
- **Builds on:** Dispatch 2's factory types.
- **Hands to:** a repo with exactly one descriptor-spec shape — the state the LSP proof (dispatch 4) and the family slices assume.
- **Focus:** `@internal/sql-contract-psl` (`interpreter.ts` + `interpreter.model-attributes.test.ts` fixtures), `@internal/target-postgres` (`core/authoring.ts` + its `psl-*-authoring` tests), ADR 236 text. The flip is atomic — contributor and consumer change together; no dual-shape fallback.
- **Model tier:** opus (substrate + spec interpretation). **Gates:** `pnpm typecheck` (workspace — downstream consumers) · `pnpm --filter @internal/sql-contract-psl lint && pnpm --filter @internal/target-postgres lint` · `pnpm --filter @internal/sql-contract-psl test` · `pnpm --filter @internal/target-postgres test` · `pnpm fixtures:check` · grep gate: no new `blindCast` beyond the reshaped narrow site.

### Dispatch 4: lsp-consumability-proof

- **Outcome:** a `@internal/language-server` test resolves a postgres project through the existing `config-resolution.ts` surface, calls `assembleAttributeSpecs`, and asserts `'rls' in specs.model` — zero production LSP changes. Slice-wide gates green.
- **Builds on:** Dispatch 3's single-shape state + Dispatch 2's assembled view.
- **Hands to:** slice-DoD: the project-DoD LSP test in partial form (extended to `@relation` in slice `sql-attributes-registered`).
- **Focus:** `@internal/language-server` `test/` only (near `config-resolution.test.ts` helpers). Test-dispatch overlay applies: the test proves registry assembly through LSP-process plumbing — it must fail if `attributeSpecs`/`modelAttributes` stop reaching the resolved stack.
- **Model tier:** sonnet (single-package test with named target). **Gates:** `pnpm --filter @internal/language-server test` + lint/typecheck for the package; slice-close: `pnpm build` · `pnpm test:packages` · `pnpm lint:deps` · `pnpm fixtures:check`.

### Dispatch 5: real-pack-consumability-proof (added mid-slice)

- **Outcome:** the real postgres pack's `@@rls` is proven LSP-consumable: a test in the repo's integration-test home (already sanctioned to depend on Domain 3 packs) resolves a postgres config through `@internal/language-server`'s `resolveConfigInputs` and asserts `assembleAttributeSpecs` yields `rls` — red if `@internal/target-postgres` deletes its `@@rls` descriptor. Added because Domain 1 may not name Domain 3 (`lint-framework-target-imports` + depcruise), so D4's in-package test uses a synthetic pack; the real-pack ¬P lives here.
- **Builds on:** Dispatch 4's in-package proof + Dispatch 3's flipped descriptor.
- **Hands to:** RC-AC1 complete in substance (synthetic-pack machinery proof + real-pack integration proof); slice A extends the same integration surface for `@relation`.
- **Focus:** integration-test package only (plus its devDependency on `@internal/language-server` if absent). No production changes anywhere.
- **Model tier:** resumed implementer. **Gates:** integration package typecheck/lint + the new test + `pnpm lint:deps`.

## Handoff-contract checks

- **Linearity:** strict chain 1→2→3→4; the one non-linear edge is dispatch 4 also consuming dispatch 2's registry surface directly (named above).
- **Completeness:** slice-DoD ← D4 (LSP test), D3 (fixtures-clean + ADR amendment + cast budget), D2 (the single new narrow). Slice-DoD item 4's cast-count gate is verified at slice close over the whole diff.

## Calibration references (thread into briefs)

Failure modes ([`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md)) applicable to this slice's shape:

- **F5** — destructive git operations forbidden without orchestrator approval (every brief's edge-case table).
- **F3** — discover broken consumers by `rg`, not repeated test-suite runs (D1's required-key change; D3's flip).
- **F11** — spec pins placement: ctx/factory types + assembly in `psl-parser`, contribution key in `framework-components` core; briefs restate as hard constraints; reviewer reconciles paths.
- **F16/F17** — every brief carries a property statement; for this slice: *core never names `AttributeSpec` — contributions transit erased, exactly one documented narrow restores typing; interpreters' known-attribute access stays total (no `undefined` checks)*. A self-acknowledged layering comment is a HALT.
- **F13/F15** — the D4 test must fail under ¬P (if contributions stopped reaching the resolved stack, or `rls` were unregistered); behavioural ACs verified by running, not code-reading.
- **F14** — gates mirror CI: biome lint per touched package, typecheck covers `test/` project, sync `origin/main` before slice-close validation + push.
- **F24/F25** — build before trusting cross-package red; "pre-existing" claims need a pristine-main check.
- **F22** — reviewer briefs: no `git stash`; use `git worktree add` for base verification.
- **F26** — fix the class, not the instance, when review findings name a structural defect.

Grep-library ([`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md)) entries to run at dispatch DoD:

- **Cross-cutting anti-patterns** — file-extension imports, `: any`, `@ts-expect-error` outside `*.test-d.ts` (all dispatches).
- **Transient project refs in long-lived docs** — the ADR 236 amendment (D3) must not reference `projects/**`; run the doc-scrub re-grep.
- Slice-specific (D3): `rg 'blindCast' packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` count unchanged vs base (reshape, not add); slice-wide net-new `blindCast` ≤ 1 (the assembler narrow).

## Open items

- **For D4:** the LSP enumeration must go through `assembleAttributeSpecs` — `Object.keys(contributions.modelAttributes)` yields namespace path segments, not attribute names (D2 nested-fixture test is the discriminator). Pin in the D4 brief.
- **For D3:** annotate `pgvectorAuthoringContributions` (`packages/2-sql/2-authoring/contract-psl/test/fixtures.ts:412`) with an explicit type when touching that fixture area — it is an unannotated literal consumed as both `AuthoringContributions` and the assembled shape, so required-key changes land on it silently (reviewer note, D1 R1).
