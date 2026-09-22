# Slice: multi-file-emit

Parent project: `projects/multifile-psl/`. Outcome contributed: contract emission reads the whole membership set — every `.prisma` file matching the configured globs and carrying the directive — instead of `inputs[0]`.

## At a glance

`ContractSourceProviderBase.inputs` becomes an array of globs; the CLI expands them (sorted, absolute) each time it assembles a `ContractSourceContext`; both PSL providers read, parse, and interpret all member files into one contract. This unblocks the playground slice (glob config) and the language-server slice (shared membership helpers, plural interpreter input).

## Chosen design

Decided in the project's [`design-decisions.md`](../../design-decisions.md) (entries 1–3, 9, 11–13); this section pins where each piece sits.

- **Directive predicate moves to `@internal/psl-parser`.** `isPrismaNextSchema` / `renameLegacyDirective` relocate from `language-server/src/schema-directive.ts` to a `psl-parser` module; the language server imports them from there (it already depends on `psl-parser`). No behavior change to the predicate.
- **Glob expansion lands in `@internal/config-loader`** as a helper (working name `expandContractInputs`): takes the finalized patterns, runs `tinyglobby` with `pathe`-absolute results, dedupes by canonical path (two globs may match the same file), sorts. Every context-assembly site calls it fresh — the standing-rule decision — so the call sites are the CLI's `contract-emit` operation, `control-api/client.ts`, the `format` operation, and the vite plugin's watch-set loop. `finalizeConfig` stays synchronous: it keeps resolving pattern strings against the config directory (`resolve` works on patterns); it never expands.
- **`ContractSourceContext.resolvedInputs` is the flat expanded list**; its positional-matching documentation is deleted.
- **`PslInterpretInput` goes plural**: `{ documents: readonly DocumentAst[]; sources; symbolTable }`. `PSL_TARGET_CONTEXT_REQUIRED` / `PSL_SCALAR_TYPE_CONTEXT_REQUIRED` become `InternalError` assertions in both interpreters (SQL + Mongo), removing the last consumer of a singular anchor document.
- **Both `contract-psl` providers** (SQL at `packages/2-sql/2-authoring/contract-psl/src/provider.ts`, Mongo twin) loop all `resolvedInputs`: read each file, apply the directive gate (a glob-matched file without the directive is silently not a member, per project decision 2), `parse` each, merge into one `PslSources`, one `buildSymbolTable({ documents })`, one `interpret`. Read failures keep the existing per-file `PSL_SCHEMA_READ_FAILED` shape.
- **The language server gets a compile-level fix only**: its `interpret` call sites pass `documents: [document]` inside the existing per-open-document loop. Behavioral migration is slice 3.
- **Output derivation**: `defaultOutputFromSchemaPath` keeps its single-path branch verbatim and gains a glob branch — the static directory prefix before the first wildcard, so `./prisma/**/*.prisma` → `./prisma/contract.json`. The postgres/sqlite/mongo `define-config` wrappers route glob-shaped `contract:` strings through the same derivation.
- **`orm format`** iterates every member file; its help text drops the `inputs[0]` wording.
- **`tinyglobby`** enters the workspace catalog (already present transitively; workspace release-age and trust policies apply).

## Coherence rationale

One outcome — "emission reads the membership set, deterministically" — traversed once along the read path: config shape → expansion → provider loop → interpreter input. The Mongo provider and the sqlite/mongo wrappers are mechanical mirrors of the SQL/postgres changes, reviewable as repeats. Splitting (e.g. interpreter-input change separately) would ship a PR whose only value is preparation, which the sizing calibration names as a non-slice.

## Scope

**In:** `@internal/config` (types + validation for glob arrays), `@internal/config-loader` (expansion helper), `@internal/psl-parser` (interpreter input, directive predicate's new home), both `contract-psl` providers and interpreters, postgres/sqlite/mongo `define-config`, CLI `contract-emit`/`client`/`format`, vite plugin input loop, catalog entry for `tinyglobby`, tests and emit fixtures for all of the above including a multi-file fixture reusable by slice 3's parity suite.

**Out:** language-server behavior (slice 3, `lsp-whole-project`); playground (slice 2, `playground-scratchpad`); `contract-prisma7` (stays directory-based per project non-goal); the TypeScript contract provider (`.ts` inputs are not globs).

## Pre-investigated edge cases

Known from the design discussion, not rediscoverable by a grep:

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Globs match zero files | Error diagnostic naming the patterns; never a silently empty contract | New diagnostic code on the provider load path |
| Files matched, but none carries the directive | Same error, listing the candidate files that lacked the directive | Directs the user at the directive trap instead of "no files found" |
| Two globs match the same file | Dedupe by canonical absolute path before sorting | Expansion helper owns this |
| File deleted between expansion and read | Existing `PSL_SCHEMA_READ_FAILED` per-file diagnostic, emission continues collecting | Matches current single-file read-failure shape |

## Slice-specific done conditions

- [ ] Emission-determinism test: the emitted contract from a multi-file fixture is byte-identical when file discovery order is permuted (delivers the project-DoD condition).
- [ ] A glob-matched file without the directive is excluded from the emitted contract, proven by test.
- [ ] `rg 'input\.document\b'` over both interpreters returns nothing (the singular anchor is gone).

## Open Questions

None — the design questions were settled in the project discussion; helper names/locations above are working positions the dispatch pre-flight may adjust within the named packages.

## References

- Parent project: [`projects/multifile-psl/spec.md`](../../spec.md)
- Decisions: [`projects/multifile-psl/design-decisions.md`](../../design-decisions.md) entries 1–3, 9, 11–13
- Linear issue: waived by operator ("skip linear")
