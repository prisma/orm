# multi-file-emit — Dispatch plan

Spec: [`./spec.md`](./spec.md). Four dispatches, sequential. Tests precede implementation within every dispatch (repo golden rule).

### Dispatch 1: plural-interpreter-input

- **Outcome:** `PslInterpretInput` carries `documents: readonly DocumentAst[]` (singular `document` gone); `PSL_TARGET_CONTEXT_REQUIRED` / `PSL_SCALAR_TYPE_CONTEXT_REQUIRED` are `InternalError` assertions in the SQL and Mongo interpreters; every consumer compiles with behavior unchanged (providers pass `documents: [document]`; the language server passes `documents: [document]` inside its existing per-open-document loop). `rg 'input\.document\b'` over both interpreters returns nothing.
- **Builds on:** The spec's chosen design.
- **Hands to:** The plural input shape all later dispatches (and slice 3 of the project) build against, with the whole workspace green.
- **Focus:** `psl-parser` interpret types, both `contract-psl` interpreters and providers, language-server call sites — compile-level only. No glob work, no multi-file reads.

### Dispatch 2: glob-inputs-through-config

- **Outcome:** `ContractSourceProviderBase.inputs` entries are documented and validated as glob patterns; `@internal/config-loader` exports the expansion helper (tinyglobby-backed, `pathe`-absolute, deduped by canonical path, sorted) with unit tests covering dedupe, sort determinism, and zero-match results; every `ContractSourceContext` assembly site (`contract-emit` operation, `control-api/client.ts`, `format` operation, vite plugin input loop) expands fresh per invocation; `resolvedInputs`' positional-matching wording is deleted; `tinyglobby` is a catalog entry. Single-path configs resolve to identical `resolvedInputs` as before.
- **Builds on:** Dispatch 1's green workspace (no type dependency; sequenced to keep one dispatch in flight).
- **Hands to:** `resolvedInputs` arriving at providers as the flat, expanded, sorted member-path list.
- **Focus:** Config types/validation, config-loader, the four assembly sites, catalog. Providers still read `resolvedInputs[0]` — acceptable intermediate state; glob configs are not yet user-advertised.

### Dispatch 3: providers-emit-membership-set

- **Outcome:** Both PSL providers read every `resolvedInputs` entry, apply the directive gate (`isPrismaNextSchema`, relocated to `psl-parser` with the language server importing the new home), parse each member into one merged `PslSources`, build one symbol table, interpret once. A glob-matched file without the directive is excluded (test-proven); zero matched files, and matched-but-none-carrying-the-directive, each produce the spec's error diagnostics; unreadable files keep per-file `PSL_SCHEMA_READ_FAILED`. A multi-file emit fixture exists and the emission-determinism test passes with permuted discovery order.
- **Builds on:** Dispatch 1's plural input + dispatch 2's expanded `resolvedInputs`.
- **Hands to:** End-to-end multi-file emission via a raw `ContractConfig`; the multi-file fixture slice 3 (`lsp-whole-project`) reuses for parity.
- **Focus:** Both providers, directive-predicate relocation, new error diagnostics, fixtures + determinism test. Not the `defineConfig` wrappers, output derivation, or format — dispatch 4.

### Dispatch 4: user-surface-and-format

- **Outcome:** `defineConfig({ contract: './prisma/**/*.prisma' })` works end-to-end on postgres/sqlite/mongo: glob strings route through `contractConfigFromPath`, default output derives from the glob's static prefix (single-path derivation unchanged, test-pinned), `orm format` formats every member file and its help text drops the `inputs[0]` wording. `pnpm fixtures:check` and `pnpm lint:deps` are clean workspace-wide.
- **Builds on:** Dispatch 3's end-to-end emission.
- **Hands to:** Slice DoD — the full user path from config string to multi-file contract; the glob config surface slice 2 (`playground-scratchpad`) generates against.
- **Focus:** The three extension `define-config` wrappers, output derivation, CLI `format` + help text, closing validation gates.

## Handoff-contract check

Non-linear edges: dispatch 3 builds on both 1 and 2 (named above). Completeness: slice-DoD condition 1 (determinism) lands in dispatch 3; condition 2 (directive exclusion) in dispatch 3; condition 3 (`input.document` grep) in dispatch 1 and re-checked at slice close.

## Size distribution

D1 M (surgical substrate change, consumers mechanical) · D2 M (single-package feature + four wiring sites) · D3 L (the slice's center: two providers + fixtures + determinism) · D4 M (mirrored wrappers + format).
