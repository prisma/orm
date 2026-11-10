# Brief: D2 glob-inputs-through-config

## Task

Give `ContractSourceProviderBase.inputs` glob semantics and make every `ContractSourceContext` assembly site expand them fresh per invocation. Add an expansion helper to `@internal/config-loader` (working name `expandContractInputs`): input is the finalized pattern list (absolute patterns — `finalizeConfig` at `packages/1-framework/3-tooling/config-loader/src/finalize-config.ts:11` keeps resolving pattern strings against the config directory and stays synchronous); the helper partitions entries: a **wildcard-free entry passes through verbatim** — no globbing, no existence check, no directory expansion — so a literal file path, a nonexistent path (its read error surfaces downstream exactly as today), and `contract-prisma7`'s directory-shaped input all reach `resolvedInputs` unchanged; only entries containing glob magic run through `tinyglobby` (`expandDirectories: false`, files only). Results are merged, deduped by canonical absolute path, and sorted. (R2 clarification: round 1 globbed literals with existence filtering, which silently broke prisma7 directory inputs and required a `format.ts` fallback workaround — both are reverted by pass-through semantics.) Wire the helper into the four assembly sites: the `contract-emit` operation (`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` — currently `resolvedInputs: contractConfig.source.inputs ?? []`), `control-api/client.ts` (same pattern), the `format` operation (`packages/1-framework/3-tooling/cli/src/control-api/operations/format.ts` — keep its `inputs[0]` consumption for now; only the resolution goes through the helper), and the vite plugin's input loop (`packages/1-framework/3-tooling/vite-plugin-contract-emit/src/plugin.ts:311-324`). Update `ContractSourceContext.resolvedInputs` documentation: it is the flat expanded list; delete the positional-matching wording (`packages/1-framework/1-core/config/src/contract-source-types.ts:40-49` and the provider `InternalError` message that restates it). Add `tinyglobby` to the workspace catalog (`pnpm-workspace.yaml` `catalog:` block) and to `config-loader`'s dependencies via `pnpm install` (never edit the lockfile by hand). Config validation (`config-validation.ts:220-227`) keeps accepting arrays of strings; extend its docs/tests to state entries are glob patterns. Tests before implementation.

## Scope

**In:** `@internal/config` (docs/validation wording + tests), `@internal/config-loader` (helper + tests), the four assembly sites, catalog + lockfile via `pnpm install`, `pnpm lint:deps` for the new dependency edge.

**Out:** Provider behavior (still reads `resolvedInputs[0]` — D3); directive gate; output derivation; `defineConfig` wrappers; language server; error semantics for zero matches (the helper returns an empty list; erroring is D3's provider concern).

## Completed when

- [ ] Helper unit tests cover: dedupe across overlapping globs, sorted deterministic output independent of filesystem enumeration, wildcard-free literal path passthrough, zero-match → empty list.
- [ ] A single-literal-path config produces `resolvedInputs` byte-identical to the pre-change behavior (test).
- [ ] All four assembly sites resolve through the helper; `rg 'source\.inputs \?\? \[\]'` under `packages/1-framework/3-tooling` returns nothing.
- [ ] Full validation gate set green.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

- Slice spec: `projects/multifile-psl/slices/multi-file-emit/spec.md`; plan § Dispatch 2; project decisions entries 1, 11, 12.
- Repo rules: `.agents/rules/no-direct-lockfile-edits.mdc`, `.agents/rules/use-pathe-for-paths.mdc`, `.agents/rules/running-tests.mdc`, `.agents/rules/git-staging.mdc`.

## Operational metadata

- **Model tier:** `mid` (`implementer/fast`).
- **Time-box:** 60 minutes wall-clock.
- **Halt conditions:** the vite plugin's watch registration needs pattern-level watching decisions beyond expand-per-invocation (surface, don't invent); `finalizeConfig` cannot stay synchronous without contortions (that contradicts the spec — halt); the catalog policy (`minimumReleaseAge`, `trustPolicy`) rejects `tinyglobby` (surface the policy error verbatim).
