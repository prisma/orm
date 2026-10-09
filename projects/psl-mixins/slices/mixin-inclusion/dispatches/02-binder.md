# Brief: mixin-inclusion D2 — the binder binds each member once

## Task

Make the binder behave as the slice spec's "Binder" section describes, now that symbol records contain mixed-in members: a mixin body is bound once in its own namespace against its own fields; an including block binds only the members written in it; a block's own attributes resolve field names against all of its fields; an inclusion's name and a mixin declaration are recorded for `symbolForNode` and `declaredSymbol`; a mixin name in type position is rejected.

## Scope

**In:**

- `psl-parser/src/binder.ts` and binder tests.
- The two compile breaks D1 reported: `language-server/src/cursor-resolution.ts` (`pslSymbolOf` has no `'mixin'` case) and `contract-psl/src/psl-column-resolution.ts:522` (a switch whose `default` relied on the old union). For the SQL file make the smallest fix that compiles and treats a mixin like any other non-type resolution; it must not add mixin-specific behaviour.
- The language server's type-position completion must not offer mixin names now that `scope.entries()` yields them. Fix where candidates are filtered by kind, with a test.

**Out:**

- Completion after `+`, completion and signature help inside a mixin body, semantic tokens for mixin bodies, `fieldTakesMap`. Those are the next slice.
- Any behaviour change in an interpreter.

## Completed when

- [ ] Binder tests: a mixin in namespace `auth` with `owner User`, included in a model in namespace `billing` that has its own `User`, resolves `owner`'s type to `auth.User`; a mixin attribute naming a field the mixin does not declare reports `PSL_UNRESOLVED_REFERENCE` once, in the mixin; a model's `@@unique([tenantId, id])` resolves `tenantId` to the mixin's field symbol; one mixin with an unresolved type, included by three models, reports that diagnostic once; a mixin nothing includes is still bound and its diagnostics reported; `symbolForNode` on an inclusion's `QualifiedName` and on its qualifier segment; `declaredSymbol` on a mixin declaration; a field typed with a mixin name gets the rejection message in the spec.
- [ ] The binder resolves an inclusion's name through `lookupMixinReference`, the function the symbol table uses.
- [ ] `pnpm typecheck` passes apart from `prisma7-adoption`; `test` and `lint` pass for `psl-parser`, `language-server` and SQL `contract-psl`; `psl-parser` is rebuilt.

## Halt conditions

- Telling a block's own members from mixed-in ones needs a change to a symbol's public shape that an interpreter, attribute spec or block spec could read. Report the options.
- An attribute spec factory needs a `ModelSymbol` or `CompositeTypeSymbol` as its context and cannot be given a `MixinSymbol` without changing the factory's public parameter type. Report the options; do not widen a public type on your own.
- An existing binder test needs its assertions changed.
