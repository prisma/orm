# mongo-attributes-registered — Dispatch plan

**Spec:** [`./spec.md`](./spec.md) · **Linear:** [TML-3229](https://linear.app/prisma-company/issue/TML-3229)

Sequence: namespace + call-site rewiring (contract-psl) → family registration + enumeration proofs → unknown-attribute diagnostics + fixture repair → slice close. Diagnostics are last by the project's transitional-shape constraint; each dispatch leaves the package suite green.

## Dispatch plan

### Dispatch 1: mongo-namespace-and-call-sites — size M

- **Outcome:** `@internal/mongo-contract-psl` exports `mongoAttributeSpecs` (`as const satisfies AttributeSpecNamespace`) carrying every Mongo built-in — new nullary `@id` / `@unique` specs, static specs behind nullary factories, the three index specs as per-model factories over `AttributeSpecContext` (replacing `buildIndexModelSpecs`) — and `interpreter.ts` sources every spec through the namespace, building the ctx from the symbol table, the current `ModelSymbol`, and a new required `controlMutationDefaults` input the provider threads from `ContractSourceContext`. Property: *the set of attribute names the interpreter can interpret is exactly the namespace's key set, and typed access at every call site stays total (`InferAttr` intact, zero new casts).*
- **Builds on:** `registry-core`'s `AttributeSpecNamespace` / `AttributeSpecContext` (`psl-parser/src/attribute-spec/spec-context.ts`).
- **Hands to:** a registrable namespace object for dispatch 2; the key sets dispatch 3's diagnostics read.
- **Focus:** `mongo-contract-psl` only (`src/mongo-attribute-specs.ts`, `src/interpreter.ts`, `src/provider.ts`, `src/exports/index.ts`, tests). Tests first: level-guard test over every factory; `@id("x")` / `@unique(1)` diagnose; index specs still parse per-model field names; `interpret()` test helper passes an explicit registry.
- **Gates:** `cd packages/2-mongo-family/2-authoring/contract-psl && pnpm typecheck` · `pnpm --filter @internal/mongo-contract-psl lint` · `pnpm --filter @internal/mongo-contract-psl test` · grep: `rg buildIndexModelSpecs packages/2-mongo-family` → empty; `rg 'blindCast' packages/2-mongo-family/2-authoring/contract-psl/src` count unchanged vs base.

### Dispatch 2: family-registration-and-enumeration — size S

- **Outcome:** `mongoFamilyDescriptor` (`control-descriptor.ts`) and `mongoFamilyPack` (`exports/pack.ts`) carry `attributeSpecs: mongoAttributeSpecs`; `@internal/family-mongo` depends on `@internal/mongo-contract-psl` in production (`pnpm install`, never a hand-edited lockfile); a `family-mongo` test pins the exact assembled key sets at both levels; an integration test resolves a Mongo project through the language server's `resolveConfigInputs` and enumerates a Mongo built-in from `assembleAttributeSpecs`. Property: *the LSP process sees the same namespace object the interpreter runs (identity through assembly).*
- **Builds on:** Dispatch 1's exported namespace.
- **Hands to:** project-DoD "Mongo's full built-in attribute surface is enumerable from the registry".
- **Focus:** `family-mongo` (descriptor, pack, package.json, test) and `test/integration/test/authoring/` (new mongo fixture config + test). No interpreter changes.
- **Gates:** `pnpm --filter @internal/family-mongo typecheck lint test` · `pnpm lint:deps` (new package edge) · `pnpm --filter integration-tests exec vitest run test/authoring/attribute-specs` after `pnpm build --filter @internal/family-mongo...`.

### Dispatch 3: unknown-attribute-diagnostics — size M

- **Outcome:** the interpreter reports `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` for model attributes and `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` for model-field and composite-type-field attributes whose names are not own keys of the namespace (messages per spec § 4); the four schema fixtures that relied on silently-ignored attributes are repaired (retail-store `@default(Active)` ×3, legacy-aggregate-raw `@default(now())` + `@updatedAt`); the contract-psl README names the registered surface and the diagnostics. Property: *the interpreter accepts exactly the registered surface; emitted contracts are byte-identical.*
- **Builds on:** Dispatch 1's namespace keys (and dispatch 2 having landed, so the diagnostic is sound against a complete registry).
- **Hands to:** project-DoD "unknown attribute names produce diagnostics … at field and model level" for Mongo.
- **Focus:** `interpreter.ts` + tests (unknown model attr, unknown field attr, dotted `@db.ObjectId`, unknown attr in a `type` block, plus a known-attribute negative control), the four fixture files, README. Test-dispatch overlay: each diagnostic test must go red if the check is removed — assert code, message, and span.
- **Gates:** package typecheck/lint/test · `pnpm fixtures:check` (retail-store emit + migration regen must still be byte-clean) · `pnpm --filter integration-tests exec vitest run test/ports/prisma/functional/legacy-aggregate-raw` if runnable locally, else note.

### Dispatch 4: slice-close — size S

- **Outcome:** slice-DoD walk (spec checklist verbatim), manual-QA script + one run report (unknown-attribute diagnostic is user-observable through `prisma contract emit`), `origin/main` synced, always-run gates re-run, PR opened with the `TML-3229:` prefix via `create-pr`.
- **Gates:** `pnpm build` · `pnpm test:packages` · `pnpm lint:deps` · `pnpm fixtures:check` · comment grep `git diff origin/main...HEAD -- '*.ts' | grep -E '^\+\s*(//|/\*|\*)'` → empty · `projects/` refs in long-lived files → 0.

## Handoff-contract checks

- **Linearity:** strict chain 1→2→3→4. Dispatch 3 reads only the namespace from dispatch 1; it waits for dispatch 2 so the transitional-shape constraint (registry complete before diagnostics) holds at every commit.
- **Completeness:** slice-DoD ← D1 (specs + namespace + level guard + grep gate), D2 (enumeration + lint:deps), D3 (diagnostics + fixtures:check), D4 (cast count, PR-side items).

## Calibration references

Failure modes ([`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md)):

- **F3** — discover consumers of `buildIndexModelSpecs`, `getAttribute`, and the interpreter input type by `rg`, not by test runs.
- **F5** — no destructive git operations; no `git stash` (F22).
- **F10** — this slice runs in parallel with `sql-attributes-registered` and `block-attributes-on-kit`; `projects/attribute-registry/trace.jsonl` and `reviews/code-review.md` are shared non-source artefacts — resolve as append-only unions on sync.
- **F13 / F15** — every diagnostic test must discriminate (red with the check removed); fixture repairs verified by running `fixtures:check`, not by reasoning.
- **F14** — biome lint per touched package; typecheck covers `test/`; sync `origin/main` before the final gates.
- **F16 / F17** — property statements above; a self-acknowledged layering comment is a halt.
- **F24 / F25** — `pnpm build` the producing package before trusting a cross-package red.

Grep-library ([`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md)): cross-cutting anti-patterns (extension imports, `: any`, `@ts-expect-error`) at every dispatch; transient-project-ref scrub on the README line (D3).

## Open items

None at plan time.

## Slice-close walk (2026-08-28)

- ✓ Specs + namespace + exact key sets pinned (`mongo-attribute-specs.test.ts`, `family-mongo/test/attribute-specs.test.ts`, integration `attribute-specs.lsp-consumability.test.ts` Mongo block).
- ✓ Grep gate: `buildIndexModelSpecs` absent; every spec constant reachable through `mongoAttributeSpecs`.
- ✓ Diagnostics at model, model-field, and composite-type-field level with span; dotted names reported whole (`interpreter.attribute-specs.test.ts`).
- ✓ Level guard: every factory's `spec.level` matches its subkey.
- ✓ `pnpm fixtures:check`: emitted `contract.json` / `contract.d.ts` byte-identical (the only diffs it reported were this slice's four `contract.prisma` source edits, now committed); `pnpm lint:deps` clean with `family-mongo → mongo-contract-psl`.
- ✓ Net-new `blindCast`: 0 (+0/−0 under `packages/**/src`).
- ✓ Comment grep over added `.ts` lines: 0. `projects/` refs in long-lived files: 0.
- ✓ QA: `projects/attribute-registry/manual-qa.md` + `manual-qa-reports/2026-08-28-mongo-attributes-registered.md` (4/4 pass).
- ✓ `origin/main` unmoved at close (0 behind).
