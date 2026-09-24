# Brief: D4 user-surface-and-format

## Task

Finish the user-facing path. (1) **Output derivation**: `defaultOutputFromSchemaPath` (`packages/2-sql/2-authoring/contract-psl/src/provider.ts:37-49`) keeps its single-path branch byte-for-byte and gains a glob branch — when the schema path contains glob magic, the default output is `<static-prefix-directory>/contract.json`, where the static prefix is the directory portion before the first magic-carrying segment (`./prisma/**/*.prisma` → `./prisma/contract.json`; a rootless pattern like `**/*.prisma` derives against the pattern's base, i.e. the config directory at resolution time — pin whichever the existing absolutization makes natural, with a test). Mirror wherever the postgres/sqlite/mongo `define-config` wrappers duplicate derivation (`packages/3-extensions/postgres/src/config/define-config.ts:29-57` and twins) — glob-shaped `contract:` strings must route through `contractConfigFromPath` to `prismaContract` with the derived output. (2) **`orm format` over the membership set**: `executeFormat` (`packages/1-framework/3-tooling/cli/src/control-api/operations/format.ts`) formats every `resolvedInputs` entry instead of `[0]`, aggregating per-file results (a read failure on one member surfaces per-file, does not abort the rest); the `orm format` help text (`packages/1-framework/3-tooling/cli/src/orm/format.ts:37`) drops the `inputs[0]` wording. (3) **Stale wording sweep**: the three remaining "positional-matched" claims (`contract-ts` SQL + Mongo, `contract-prisma7` providers — see `learnings.md` item 4) get the same rewording D2 gave the PSL providers. (4) An end-to-end test: `defineConfig({ contract: '<glob>' })` on postgres emits a multi-file contract with the derived default output path (reuse D3's fixture shape). Closing gates for the slice: `pnpm fixtures:check` and `pnpm lint:deps` workspace-clean. Tests before implementation.

## Scope

**In:** SQL provider's output derivation + the three extension `define-config` wrappers; `format.ts` operation + `orm/format.ts` help text; the three stale-wording sites; e2e defineConfig test; closing gates.

**Out:** Language-server behavior (slice 3); playground (slice 2); any new error codes (D3 owns them); expansion helper internals (D2, done).

## Completed when

- [ ] Glob-derivation unit tests green, single-path derivation tests untouched and green.
- [ ] `orm format` formats a multi-file fixture end-to-end (test), help text updated; `rg 'inputs\[0\]'` over `format.ts` + `orm/format.ts` returns nothing.
- [ ] `rg -i 'positional-matched' packages/2-sql packages/2-mongo-family packages/1-framework/1-core/config` returns nothing. (R1 correction, on implementer pushback: the original bare `positional` gate was unsatisfiable — that word is legitimate PSL attribute-argument vocabulary in ~136 unrelated hits; the target is the stale `positional-matched` claim only.)
- [ ] `pnpm fixtures:check` and `pnpm lint:deps` clean workspace-wide.
- [ ] Full validation gates green.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

- Slice spec § Chosen design (output derivation + format bullets); plan § Dispatch 4; project decisions entries 9, 13.
- Repo rules: `.agents/rules/cli-error-handling.mdc` (format aggregation), `.agents/rules/running-tests.mdc`, `.agents/rules/git-staging.mdc`.

## Operational metadata

## R3 addendum (orchestrator, post-R2)

The last `fixtures:check` failure is a D3 escapee: 6 `expected-diagnostics.json` parity fixtures assert the pre-D3 relative `sourceId` (`"./schema.prisma"`), while D3 made diagnostics carry each member's resolved absolute path. Checked-in fixtures cannot hold absolute paths (the parity app runs in a per-run temp directory). Fix at the harness, not the provider and not the fixtures-as-absolute: `cli.emit-parity-fixtures.test.ts` (and its write-mode path) normalizes each diagnostic `sourceId` by relativizing paths under the test app directory to the `./`-prefixed form before comparing/writing. Expected outcome: the 6 checked-in fixtures need no semantic change (the normalized form reproduces the old convention); `pnpm fixtures:check` exits 0. D3's runtime behavior is untouched.

## Operational metadata

- **Model tier:** `mid` (`implementer/fast`).
- **Time-box:** 60 minutes wall-clock.
- **Halt conditions:** derivation for rootless patterns turns ambiguous beyond the pinned test (surface, don't invent); `fixtures:check` drift in files unrelated to this slice (investigate, surface if not yours); an out-of-scope surface must change.
