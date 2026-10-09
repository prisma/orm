# Brief: mixin-navigation D2 — semantic tokens for mixin bodies and inclusions

## Task

Make the language server's semantic tokens cover a mixin's body and every inclusion, as the slice spec's "Semantic tokens" section states, and update the language-server README for this slice.

## Scope

**In:** `language-server/src/semantic-tokens.ts` and its tests; `language-server/README.md` where it lists what definition, references, hover, rename and semantic tokens answer for; in `psl-parser`, at most one accessor on an AST class that yields a body's members in source order including inclusions, with a test, if the token walker needs it.

**Out:** completion and signature help; any other `psl-parser` change.

## Completed when

- [ ] Token tests for a `model` mixin, an `enum` mixin and a `key = value` mixin body, and for an inclusion with and without a namespace qualifier inside a model, a generic block and a mixin body, asserting token types, modifiers and order.
- [ ] A test that tokens for the non-mixin parts of each document equal what the same document gives on the base branch (the existing header-only test's "rest unchanged" assertion, kept).
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and `lint` for each touched package pass, apart from the known environment failures.

## Halt conditions

- The token legend needs a new token type or modifier.
- An existing semantic-tokens test needs its assertions changed, other than the header-only mixin test this dispatch supersedes.
