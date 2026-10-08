# Brief: D1 — the binder binds entity-constructor arguments

## Task

Make the PSL binder record a resolution on the entity argument of a type constructor that declares `entityRefArg`. The design is the "Binder" section of the slice spec; follow it. The argument is bound through the code path an `entityRef` attribute argument takes (`writtenEntityReference`, `resolveEntity`), not through a new lookup.

## Scope

**In:** `packages/1-framework/2-authoring/psl-parser/src/binder.ts` (and `resolve.ts` or `entity-reference.ts` only if the argument's node cannot be reached otherwise); binder tests under `packages/1-framework/2-authoring/psl-parser/test/`.

**Out:**

- Any interpreter, the language server, the Postgres target (next dispatches).
- Reading `entityRefArg.entityKind` in the binder, or any check of what kind of entity the name resolved to.
- A diagnostic for an argument that is not a name.
- `projects/**` (read-only for you).

## Completed when

- [ ] Tests, written before the implementation, cover: a name in scope (a block, and a model, to show the kind is not checked); a qualified name, with the qualifier's namespace resolution; an unknown name (one `PSL_UNRESOLVED_REFERENCE` anchored on the argument, and an `unresolved` resolution); a string, a number, a three-segment path, a named argument and no argument (nothing recorded, no diagnostic); a constructor without `entityRefArg` (its arguments get nothing).
- [ ] Each of those that depends on scope is covered for a field of a model at top level, a field of a model in a namespace, a field of a composite type, and a named type. For the named type: a top-level entity resolves, a namespaced one resolves when qualified, and a named type's own name does not resolve to itself.
- [ ] Plain `it` per case, names state the behaviour, no "should", no `it.each` over booleans.
- [ ] No comment added. No bare `as` in `src/`. The framework vocabulary lint reports nothing on changed lines.
- [ ] `typecheck`, `lint` and the full test run pass for `psl-parser`.
- [ ] You ran the tests of SQL `contract-psl`, the Postgres target and the language server once and list every test that now fails, with its failure, without changing those packages.
- [ ] Work is committed on `type-constructor-refs` (new commits, `-s`, no amend, no rebase, no push).

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/lsp-rename/slices/type-constructor-refs/spec.md`
- `binder.ts`: the named-types loop and the field-types loop (where the type name is resolved), `resolveEntity`, `bindQualifier`, the `entityRef` case of `tryBindExpression`
- `psl-parser/src/entity-reference.ts` (`writtenEntityReference`), `resolve.ts` (`ResolvedTypeConstructorCall`, `ResolvedAttributeArg.expression`)
- `AuthoringTypeConstructorDescriptor.entityRefArg` in `framework-components/src/shared/framework-authoring.ts`
- Test precedents: `test/binder-argument-resolutions.test.ts`, `test/block-binder.qualified-entity.test.ts`, `test/binder-contributed-types.test.ts`
- The `psl-ast-layers` skill: `skills-contrib/psl-ast-layers/SKILL.md`
- The binder rules in `packages/1-framework/2-authoring/psl-parser/README.md` § Binder

## Operational metadata

- **Time-box:** 60 minutes.
- **Halt conditions:**
  - a statement in the slice spec turns out to be false in the code;
  - the argument cannot be bound without a new lookup or without the binder checking entity kinds;
  - a file outside "Scope: In" needs a change.
