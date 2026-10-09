# Brief: mixin-completion D5 — one diagnostic for a mixin written without its keyword

## Task

Manual QA found that `mixin Timestamps { … }` (no block keyword) included by a model with `+Timestamps` is reported at the inclusion as `"Timestamps" is a mixin, not a mixin`, and that the declaration itself gets three diagnostics: the intended one, `Unsupported top-level block "mixin"`, and `Invalid block entry` for each body line. Make this mistake produce true, non-repeating diagnostics.

## Required behaviour

For `mixin X { … }` under the default grammar, at the top level and in a namespace:

1. Exactly one diagnostic for the declaration: the existing `A mixin starts with the keyword of the block it is for, for example "model mixin X"`.
2. No diagnostic for the body's members: the parser cannot know the body's grammar, so the body is kept in the tree as it is read today (the tree must still print back to the source) but its member diagnostics are not reported.
3. The declaration is not collected as a block: it is absent from `blocks`, takes no part in the duplicate-name check, and gets no "unsupported block" diagnostic.
4. `+X` naming it reports `Cannot find mixin "X"` at the inclusion.

The `prisma-7` grammar is unchanged: there `mixin X { … }` is an ordinary generic block.

## Scope

**In:** `psl-parser` (`parse.ts`, `symbol-table.ts`, `unclaimed-blocks.ts` if that is where the unsupported-block diagnostic comes from) and tests. Check whether the SQL, Mongo, Prisma 7 and Prisma 6 interpreters report an unknown block keyword on their own; if one does for this input, say so and stop before changing it.

**Out:** everything else.

## Completed when

- [ ] Tests for the four required behaviours, at the top level and inside a namespace, plus the `prisma-7` grammar unchanged.
- [ ] A contract-level test in SQL `contract-psl`: a schema with `mixin X { createdAt DateTime }` and a model with `+X` reports exactly two diagnostics, the declaration one and `Cannot find mixin "X"`.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and `lint` for touched packages pass apart from the known environment failures.

## Halt conditions

- Suppressing the body's member diagnostics needs the parser to carry state that changes how any other block is parsed.
- An existing assertion outside the mixin tests needs changing.
