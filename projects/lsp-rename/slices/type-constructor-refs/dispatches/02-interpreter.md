# Brief: D2 — the SQL interpreter reads the binder's resolution

## Task

Make `resolveEntityRefTypeConstructorCall` (SQL `contract-psl`, `psl-column-resolution.ts`) read the binder's resolution on the constructor's entity argument and find the lowered entity by block symbol, instead of looking the argument's text up in `namespaceExtensionEntities`. The design is the slice spec's sections "SQL interpreter" and "What the wider binder scope changes (transitional)". The Prisma 7 interpreter shares the function: split out the part that turns a resolved entity into a column, and call it from both.

## Scope

**In:**

- `packages/2-sql/2-authoring/contract-psl/src/`: `interpreter.ts` (a `BlockSymbol`-keyed map filled where extension blocks are lowered), `psl-column-resolution.ts`, `psl-field-resolution.ts` and other files only as far as the new input has to be threaded.
- `packages/2-sql/2-authoring/contract-prisma7/src/interpreter.ts`: the call site.
- Tests of both packages and of the Postgres target (`packages/3-targets/3-targets/postgres/test/psl-pg-enum-column.test.ts`).

**Out:**

- Making a reference to another namespace produce a column (slice 3): it is refused here, with the diagnostic of the transitional table.
- Named types over the constructor (slice 4): `psl-named-type-resolution.ts` is not changed.
- The binder, the language server, the Postgres target's `src`, `contract print`, the TypeScript builder.
- `projects/**` (read-only for you).

## Completed when

- [ ] Tests first. One per row of the slice spec's resolution table and one per row of its transitional table, through the real binder and interpreter (no hand-built resolutions where a schema can express the case).
- [ ] An unknown name produces exactly one diagnostic, the binder's: the existing tests that accept `PSL_UNKNOWN_ENTITY_REF` loosely for that case are tightened to assert the full diagnostic list.
- [ ] No lookup of the argument's text remains: nothing in `contract-psl/src` indexes an entity map by the written argument. `namespaceExtensionEntities` keyed by name is removed from this path if nothing else needs it; say what still reads it.
- [ ] No entry point keeps the lookup by name for Prisma 7: the shared function takes the resolved entity (entity, entity kind, namespace id, name, whether a value set was derived) and the Prisma 7 call site passes what it already has. Prisma 7's own behaviour, including its cross-schema refusal, is unchanged; its tests pass without edits or you list each edit and why.
- [ ] For every schema that was valid before, the emitted contract is identical: the existing same-namespace tests pass with unchanged expectations, and `pnpm fixtures:check` passes.
- [ ] The wrong-kind and other-namespace diagnostics use `PSL_UNKNOWN_ENTITY_REF`, are anchored where today's is, and say what the name resolved to and what was expected (working wording in the slice spec's Open Questions; improve it if the code gives you better facts, and report the final text).
- [ ] No comment added. No bare `as` in `src/`. Plain `it` per case.
- [ ] Gate, once at the end: typecheck, lint and tests of `contract-psl`, `contract-prisma7` and the Postgres target; `pnpm typecheck`; `pnpm lint:deps`; `pnpm fixtures:check`; `pnpm test:packages`; `node scripts/lint-throws.mjs`.
- [ ] Work is committed on `type-constructor-refs` (new commits, `-s`, no amend, no rebase, no push).

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/lsp-rename/slices/type-constructor-refs/spec.md`
- The symbol-keyed precedent: `enumTypeDescriptors` (`interpreter.ts`, `processEnumDeclarations`) and the `block` case of `resolveFieldTypeDescriptor`; the `InternalError(... binder bug)` arm for resolution kinds that cannot occur
- Namespace id of a resolved block: `resolveNamespaceIdForSqlTarget` and how `modelCoordinateOf` derives a namespace for a referenced model
- Lowering: `lowerExtensionBlocksForNamespace` and the top-level bucket in `interpreter.ts`
- Prisma 7: `lowerNativeEnums` and the `instantiateFieldTypeConstructor` call in `contract-prisma7/src/interpreter.ts`
- Owner's rules for interpreters: nothing in an interpreter looks a name up; it reads `binder.symbolForNode`; it does not repeat or filter a binder diagnostic; no wrapper keeps an old interface.

## Operational metadata

- **Time-box:** 120 minutes.
- **Halt conditions:**
  - a statement in the slice spec turns out to be false in the code;
  - a schema that is valid today would emit a different contract;
  - the Prisma 7 call site cannot supply the resolved entity without a lookup by name of its own that did not exist before;
  - the composite-type or no-namespace paths need a behaviour the spec does not state;
  - a file outside "Scope: In" needs a change.
