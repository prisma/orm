# Slice: type-constructor-refs

Parent project: [`projects/lsp-rename/`](../../spec.md). Outcome for the project: renaming a `native_enum` block also renames its usages in `pg.enum(...)`, because the binder resolves them.

## At a glance

The binder records a resolution for the entity name inside a type-constructor argument (`OrderStatus` in `status pg.enum(OrderStatus)`), so go-to-definition, hover, find references and rename work on such a name with no change of their own. The SQL interpreter is not changed.

## Chosen design

### Binder (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`)

A type constructor already says which argument names an entity: `entityRefArg: { index, entityKind }` on `AuthoringTypeConstructorDescriptor` (`pg.enum` is the only declarer). The binder reads `entityRefArg.index` from the descriptor it has already resolved for the type name; it does not read `entityKind`, as it ignores the expected kind of an `entityRef` attribute argument.

For a type whose name resolves to a `contributedType` with `entityRefArg`, the binder takes the positional argument at that index and, when `writtenEntityReference` accepts its node (an identifier, or a path of two segments), resolves it with `resolveEntity` and records the result on the argument node. This is the same code path an `entityRef` attribute argument takes, with the same outcomes:

- a name in scope: its resolution, whatever kind it has;
- a qualified name: the qualifier gets its namespace resolution, the path gets the entity's;
- an unknown name: `PSL_UNRESOLVED_REFERENCE`, `Cannot find entity "X"`, anchored on the argument, and an `unresolved` resolution;
- any other argument shape (a string, a number, a longer path, a named argument, no argument): nothing recorded and no diagnostic.

Three places bind it, each with the scope that place already uses for the type name:

| Where | Scope |
|---|---|
| field of a model | the scope of the model (its namespace, then the document) |
| field of a composite type | the same |
| named type (`types { Status = pg.enum(OrderStatus) }`) | the named-type base scope: the document without named types, so a named type cannot resolve to itself |

### SQL interpreter: not changed (operator decision, 2026-10-09)

The fix for rename belongs to the binder. The SQL interpreter keeps resolving the constructor argument from its written text, exactly as on `main`; changing it is out of scope of this project.

Consequences of the binder binding a name the interpreter still resolves on its own:

| Schema | `main` | After this slice |
|---|---|---|
| unknown name in `pg.enum(...)` | `PSL_UNKNOWN_ENTITY_REF` on the type | the same, plus the binder's `PSL_UNRESOLVED_REFERENCE`, `Cannot find entity "X"`, on the argument |
| top-level model, `X` declared in `namespace public { }`, written unqualified | works (both are `public`) | the binder reports `Cannot find entity "X"`, because a name inside a namespace is not in scope outside it; the interpreter still produces the column |
| everything else | | unchanged; navigation and rename work wherever the binder resolves the name |

### Language server

No source change. Tests are added for go-to-definition, hover, find references and rename on a constructor argument, with a fixture constructor that declares `entityRefArg`. Completion inside constructor arguments stays unsupported.

## Coherence rationale

One binder function and its tests, plus two find-references cases in the language server.

## Scope

**In:** `psl-parser` binder and its tests; language-server tests in the existing suites.

**Out:** the SQL and Prisma 7 interpreters; everything listed in the project plan for slices 3 and 4.

### Contract impact

None.

### Adapter impact

None.

## Pre-investigated edge cases

**None pre-investigated.**

## Slice-specific done conditions

- [ ] `git diff` against the merge base touches only `psl-parser/src/binder.ts`, binder tests and language-server tests under `packages/`.

## Open Questions

None.

## References

- Parent project: `projects/lsp-rename/spec.md`
- ADR 262 (block specs bind top-level block values): the binder binds reference-kinded arguments; an unresolved reference is reported once, by the binder.
- `packages/1-framework/2-authoring/psl-parser/README.md` § Binder: the binder resolves names; interpretation checks how a resolved name is used.
- Operator decisions of 2026-10-08: the binder reads the existing `entityRefArg`; references across namespaces are to work; the named-type form is to be bound and to work.
