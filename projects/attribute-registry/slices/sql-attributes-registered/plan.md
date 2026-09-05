# sql-attributes-registered — Dispatch plan

**Spec:** [`./spec.md`](./spec.md) · **Linear:** [TML-3228](https://linear.app/prisma-company/issue/TML-3228)

Sequence: the namespace lands beside the existing constants (stable, nothing consumes it yet) → every call site is rewired and the constants stop being exported → the family registers the namespace and the LSP proofs reach final form → the two unknown-attribute checks become key-driven. Diagnostics are last by construction (spec § 4, project transitional-shape constraint).

## Dispatch plan

### Dispatch 1: sql-attribute-namespace

- **Outcome:** `@internal/sql-contract-psl` exports `sqlAttributeSpecs` (`as const satisfies AttributeSpecNamespace`, spec § 1) from the new `./attribute-specs` package export: eight model factories, six field factories; `relationFieldSpec` and `relationInvariants` moved into `sql-attribute-specs.ts` with `psl-relation-resolution.ts` importing `SqlRelationOutput` back; the single `default` factory over `FieldAttributeSpecContext` replaces `buildDefaultSpec` + `buildEnumDefaultSpec` (enum arm from the symbol table's `enum` block, spec § 1 + edge cases); `modelSpecContext` / `fieldSpecContext` helpers. Tests: the level/name guard over every factory (spec § 5); `default` factory yields the enum grammar for a top-level enum, a namespaced enum, and the scalar/list/`funcCall` grammar otherwise; the empty-enum case yields no arms. The existing spec constants remain exported in this dispatch so every consumer still compiles.
- **Builds on:** the spec's chosen design § 1 and § 5; registry-core's `AttributeSpecNamespace` / ctx types (`psl-parser/src/attribute-spec/spec-context.ts`).
- **Hands to:** a complete, tested namespace whose factories are the only spec source the next dispatch needs; the old constants still present as a bridge.
- **Focus:** `@internal/sql-contract-psl` `src/sql-attribute-specs.ts`, `src/exports/attribute-specs.ts`, `package.json`, tests. No call-site changes (dispatch 2), no family changes (dispatch 3).
- **Model tier:** opus (the `default` factory's enum resolution is design-bearing; the rest is substrate). **Gates:** `pnpm --filter @internal/sql-contract-psl typecheck` (incl. test project) · `pnpm --filter @internal/sql-contract-psl lint` · `pnpm --filter @internal/sql-contract-psl test` · `pnpm --filter @internal/sql-contract-psl build` (the new export must resolve).

### Dispatch 2: rewire-sql-call-sites

- **Outcome:** every `spec:` argument in `interpreter.ts`, `psl-field-resolution.ts`, `psl-column-resolution.ts`, `psl-relation-resolution.ts` reads `sqlAttributeSpecs.<level>.<name>(ctx)`; `symbolTable` / `defaultFunctionRegistry` / `controlMutationDefaults` are threaded additively per the spec § 3 table; `buildDefaultSpec`, `buildEnumDefaultSpec`, and every individual spec constant are no longer exported from `sql-attribute-specs.ts`; the grep gate in spec § slice-DoD returns empty; emitted contracts unchanged.
- **Builds on:** Dispatch 1's namespace.
- **Hands to:** one spec source in the package — the state the family registration (dispatch 3) and the diagnostics swap (dispatch 4) assume.
- **Focus:** the four interpreter files + their tests (test inputs that construct `CollectResolvedFieldsInput` / `buildModelMappings` / `interpretRelationAttribute` gain the new keys). Mechanical fan-out; no new behaviour, no diagnostics changes.
- **Model tier:** sonnet (uniform transformation with a strong gate; the judgment landed in dispatch 1). **Gates:** `pnpm --filter @internal/sql-contract-psl typecheck` · `… lint` · `… test` · `pnpm fixtures:check` · grep gate `rg "ModelSpec\b|FieldSpec\b|buildDefaultSpec|buildEnumDefaultSpec" packages/2-sql/2-authoring/contract-psl/src --glob '!sql-attribute-specs.ts'` → empty · `rg 'blindCast' packages/2-sql/2-authoring/contract-psl/src` count unchanged vs base.

### Dispatch 3: register-and-prove

- **Outcome:** `@internal/family-sql` depends on `@internal/sql-contract-psl` (prod) and both `src/exports/pack.ts` and `src/core/control-descriptor.ts` declare `authoring.attributeSpecs: sqlAttributeSpecs`; the in-package LSP test (`language-server/test/attribute-spec-consumability.test.ts`) registers a synthetic family namespace and enumerates a field factory through `resolveConfigInputs` → `assembleAttributeSpecs`; the integration test (`test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts`) enumerates `@relation`'s named arguments and the full model/field key sets from the real postgres project (spec § 6) — red if the family stops registering.
- **Builds on:** Dispatch 2's single-source state (the namespace must be the one the interpreter runs, so the LSP reads exactly what the interpreter executes — design decision 4).
- **Hands to:** project-DoD item "LSP-side test enumerates a family built-in + a target-contributed attribute" in final form; the registered family contributions that unknown-name checks could, in principle, consume.
- **Focus:** `packages/2-sql/9-family` (package.json + two files), the two test files. No production LSP change. `pnpm lint:deps` is a gate here (package-boundary change).
- **Model tier:** sonnet. **Gates:** `pnpm --filter @internal/family-sql build && pnpm --filter @internal/family-sql typecheck` · `pnpm lint:deps` · `pnpm --filter @internal/language-server test` · integration package test for the extended file · `pnpm typecheck` (workspace — every config that imports the family pack).

### Dispatch 4: registry-driven-unknown-attributes

- **Outcome:** `BUILTIN_FIELD_ATTRIBUTE_NAMES` is deleted and the field-level check uses `Object.hasOwn(sqlAttributeSpecs.field, name)`; the model-attribute loop gains the single up-front guard (`Object.hasOwn(sqlAttributeSpecs.model, name)` or contributed) routing to the existing uncomposed-namespace / `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` tail (spec § 4, open question 1). Tests: a model-level and a field-level unknown-name case each assert the diagnostic, and one case each asserts that every registered name is *not* diagnosed (the ¬P: deleting a namespace entry turns the test red). Slice-wide gates green; slice-close ritual walked.
- **Builds on:** Dispatch 2's namespace-as-sole-source; Dispatch 3 only in the sense that the full set is registered before any diagnostic is derived from it.
- **Hands to:** slice-DoD complete: grep gate, `fixtures:check`, LSP final-form test, zero new casts.
- **Focus:** `psl-field-resolution.ts:166–260`, `interpreter.ts:838–1150`, tests. Message text and codes untouched.
- **Model tier:** sonnet. **Gates:** `pnpm --filter @internal/sql-contract-psl test` · `pnpm fixtures:check` · slice-close: sync `origin/main`, then `pnpm build` · `pnpm test:packages` · `pnpm lint:deps` · `pnpm fixtures:check` · comment grep `git diff origin/main...HEAD -- '*.ts' | grep -E '^\+\s*(//|/\*|\*)'` → empty.

## Handoff-contract checks

- **Linearity:** 1→2→3→4 is strict except that dispatch 4 builds on dispatch 2's state directly (named above); dispatch 3 could run before or after 4 without conflict, but the spec's transitional-shape reading puts registration first.
- **Completeness:** slice-DoD ← D2 (grep gate, fixtures), D3 (LSP final-form test), D4 (fixtures re-verified at close), D1+D2 (zero new casts — verified slice-wide at close).

## Calibration references (thread into briefs)

Failure modes ([`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md)):

- **F5** — no destructive git operations without orchestrator approval.
- **F3** — discover broken consumers by `rg`, not by repeated test runs (D2's un-export; D3's new input keys).
- **F11** — placement is pinned: namespace + factories in `sql-contract-psl`, registration in `family-sql`; nothing new in `psl-parser` or `framework-components`.
- **F16/F17** — property statement for every brief: *interpreters' known-attribute access stays total and `InferAttr`-typed through the `const` namespace; the assembled view is read only by the LSP tests and the unknown-name checks; no new `blindCast`.* A self-acknowledged cast or `undefined` check on a known name is a HALT.
- **F13/F15** — the D3 integration test and D4 ¬P tests must be shown red under their negations; behavioural ACs verified by running.
- **F14** — gates mirror CI: biome lint per touched package, typecheck includes `test/`, sync `origin/main` before slice-close validation + push.
- **F24/F25** — build before trusting cross-package red (D3's family build feeds every config fixture).
- **F22** — reviewer: no `git stash`; `git worktree add` for base verification.
- **F26** — fix the class, not the instance.
- **Operator rule (registry-core D6):** zero comment lines added to `.ts` files in this PR — briefs state it up front so no strip dispatch is needed.

Grep-library ([`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md)) entries at dispatch DoD:

- Cross-cutting anti-patterns — file-extension imports, `: any`, `@ts-expect-error` outside `*.test-d.ts`.
- Transient project refs — no `projects/**` references in long-lived files (all dispatches touch only code + tests; no docs planned).
- Slice-specific: the spec's grep gate (D2 onward); `rg 'BUILTIN_FIELD_ATTRIBUTE_NAMES' packages/` → empty after D4.

## Open items

- **For D1:** confirm at grep pre-flight that `psl-parser` exports `InferAttr` (needed for `SqlRelationOutput` after the move); registry-core's barrel lists the `types` re-export at `src/exports/index.ts:82`.
- **For D2:** `buildModelMappings` is called once (`interpreter.ts` ~`:2380`); verify no test calls it directly before changing its signature — if tests do, adapt them in the same dispatch.
- **For D3:** the integration test currently constructs its ctx with `buildSymbolTable({ …, pslBlockDescriptors: {} })`; `@relation`'s spec is static, so the ctx content does not matter for enumerating its named keys — keep the existing helper.
