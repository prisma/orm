# Brief: mixin-completion D2 — completion and signature help inside a mixin body, and keys from symbols

## Task

Finish D1's two leftovers, then make completion and signature help inside a mixin body behave as inside a block of the mixin's keyword, and make a struct block's "keys already present" come from its symbol. The slice spec's "Inside a mixin body" table and "Keys a block already has" paragraph are the contract.

## D1 leftovers

1. Add `'+'` to the completion trigger characters in `src/server.ts` and to the two expected lists in `test/server.test.ts` and `test/start-server.test.ts`. Those two assertions describe the capability list, which the spec changes.
2. After an unqualified `+`, offer a namespace only when it has a mixin that would be offered after `+<namespace>.` (matching keyword, not already included). The spec now says so; this matches what entity-reference completion does for namespaces.

## Scope

**In:** `src/completion-context.ts`, `src/completion-provider.ts`, `src/completion-symbols.ts`, `src/completion-values.ts`, `src/signature-context.ts`, `src/signature-help.ts`, `src/attribute-spec-resolution.ts`, `src/server.ts`, tests, and the language-server README's completion and signature-help sections.

**Out:** `psl-parser`; interpreters; new items at the start of an empty member line; snippets.

## Completed when

- [ ] For each cell of the spec's "Inside a mixin body" table, a test asserting that the completion items (or the signature) at that position in a mixin equal those at the same position in an ordinary block of that keyword. For field-name positions the comparison is against a block with the same fields as the mixin.
- [ ] A test that no declaration keyword is offered at any of those positions.
- [ ] A struct block that includes a mixin providing one of its keys is not offered that key; the same block without the inclusion is.
- [ ] The edge-case rows of the spec for an unregistered extension keyword and an unclosed mixin.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and language-server `lint` pass apart from the known environment failures.

## Halt conditions

- A cell cannot be made equal to its ordinary-block counterpart without a change in `psl-parser`.
- An existing completion or signature-help test needs its assertions changed, other than the two trigger-list assertions above and the existing "does not throw inside a mixin" test this dispatch supersedes.
