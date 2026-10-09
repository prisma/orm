# Brief: mixin-completion D1 — completion after `+`

## Task

In `packages/1-framework/3-tooling/language-server`, make completion after `+` offer what the slice spec's "Completion after `+`" table states, and make `+` a trigger character.

## Scope

**In:** `src/completion-context.ts`, `src/completion-provider.ts`, `src/completion-scope.ts`, `src/server.ts`, tests.

**Out:** completion and signature help inside a mixin body, and reading existing keys from symbols (dispatch 2); `psl-parser`.

## Completed when

- [ ] A test per table row, in a model, a composite type, an enum and a `key = value` struct block, each asserting the exact item labels and details.
- [ ] Tests that these are not offered: a mixin for another keyword; a mixin the block already includes; a mixin in a namespace an unqualified name would not reach; anything after `+` inside a mixin body; `key = ` items after `+` in a struct block.
- [ ] `pnpm --filter @internal/language-server typecheck`, `test` and `lint` pass.

## Halt conditions

- The candidate set cannot be built from scope entries and `lookupMixinReference` without duplicating the lookup rule in the language server.
- An existing completion test's assertions need changing.
