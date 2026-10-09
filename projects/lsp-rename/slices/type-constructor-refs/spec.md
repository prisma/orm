# Slice: type-constructor-refs

Parent project: [`projects/lsp-rename/`](../../spec.md). Outcome for the project: renaming a `native_enum` block also renames its usages in `pg.enum(...)`, because the binder resolves them.

## At a glance

The binder records a resolution for the entity name inside a type-constructor argument (`OrderStatus` in `status pg.enum(OrderStatus)`), and the SQL interpreter reads that resolution instead of looking the name up. Go-to-definition, hover, find references and rename then work on such a name with no change of their own.

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

### SQL interpreter (`packages/2-sql/2-authoring/contract-psl`, amended 2026-10-09 after PR review)

The change is confined to where the entity name comes from. Everything after that point in `resolveEntityRefTypeConstructorCall` stays as it is on `main`: the map of lowered entities, the lookup in the field's namespace, the diagnostics and their texts, the `columnFromEntity` hook, the value-set reference.

- On `main` the name is the written text of the argument. Now the PSL path reads `binder.symbolForNode` on the argument's node:

| Resolution on the argument | Result |
|---|---|
| `unresolved` | no diagnostic from the interpreter: the binder reported it |
| a block whose namespace is the field's namespace | the entity name is the block's name; the rest of the function runs as on `main` |
| anything else (a model, a namespace, a block of another namespace) | the existing `PSL_UNKNOWN_ENTITY_REF` diagnostic, unchanged |
| none, because the argument is not a name | the existing arity diagnostic, unchanged |

- The namespace comparison uses namespace ids from `resolveNamespaceIdForSqlTarget`, the way a referenced model's namespace is found today. It is there so that a qualified `other.X` cannot pick up a same-named entity of the field's own namespace. It is transitional: slice 3 looks the entity up in the resolved block's namespace and removes the comparison.
- No new map, type, export or diagnostic text. `interpreter.ts` changes only where it has to pass the binder.
- **The Prisma 7 interpreter is not changed.** It keeps calling `instantiateFieldTypeConstructor` with its synthesized call; it has no binder, and its enum name is not a PSL reference.

### What changes for schema authors

| Schema | `main` | After this slice |
|---|---|---|
| unknown name in `pg.enum(...)` | `PSL_UNKNOWN_ENTITY_REF` on the type | `PSL_UNRESOLVED_REFERENCE`, `Cannot find entity "X"`, on the argument |
| `pg.enum(auth.X)` from a model inside `auth` | `PSL_UNKNOWN_ENTITY_REF` | works |
| top-level model, `X` declared in `namespace public { }`, written unqualified | works (both are `public`) | `Cannot find entity "X"`; `public.X` works. A name inside a namespace is not in scope outside it, as for models |
| an entity of another namespace, a model with the enum's name | `PSL_UNKNOWN_ENTITY_REF` | the same diagnostic; navigation and rename work on the name |

A named type over the constructor is bound by the binder and fails interpretation exactly as on `main`.

### Language server

No source change. Tests are added for go-to-definition, hover, find references and rename on a constructor argument, with a fixture constructor that declares `entityRefArg`. Completion inside constructor arguments stays unsupported.

## Coherence rationale

The binder change alone would produce two diagnostics for an unknown name (the binder's and the interpreter's), so the interpreter has to take the name from the binder in the same PR. The reviewer reads one binder addition and a few lines at the top of one interpreter function.

## Scope

**In:** `psl-parser` binder and its tests; SQL `contract-psl` (`psl-column-resolution.ts`, and passing the binder where it is not passed yet) and its tests; Postgres target tests for `pg.enum` columns; language-server tests in the existing suites; the QA rerun of the `native_enum` rename.

**Out:**

- References across namespaces producing a column (slice 3), and a named type over an entity constructor producing a column (slice 4). The operator confirmed on 2026-10-09 that both stay in this project.
- The Prisma 7 interpreter, a symbol-keyed map of lowered entities, new diagnostic texts.
- Completion, signature help and hover text for constructor arguments.
- Replacing `entityRefArg` with an argument spec.
- The value-set entry keyed by the block name (observed in slice 1).
- The Mongo interpreter and the SQLite target: neither has an entity constructor.

### Contract impact

None. For every schema that is valid before and after, the emitted contract is identical.

### Adapter impact

None. The Postgres target's source does not change; its tests gain cases.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Unknown name | One diagnostic, the binder's, on the argument | Two tests accepted `PSL_UNKNOWN_ENTITY_REF` loosely; they assert the full list |
| `pg.enum(other.X)` from a model whose own namespace also declares an `X` | The existing `PSL_UNKNOWN_ENTITY_REF`; the entity of the field's namespace is not used | The reason for the namespace comparison |
| Language-server completion tests with an undeclared `pg.enum(StatusValues)` | Change them only if they assert on diagnostics | `completion-symbols.test.ts` |

## Slice-specific done conditions

- [ ] `git diff origin/main -- packages/2-sql/2-authoring/contract-prisma7` is empty, and the diff of `contract-psl/src` is confined to `psl-column-resolution.ts` plus passing the binder.
- [ ] For the existing same-namespace fixtures the emitted contract is unchanged; `pnpm fixtures:check` passes.
- [ ] A test per row of the two tables above.
- [ ] Language-server tests for the constructor argument are in the existing suites, not in a file of their own.
- [ ] The QA scenario that failed in slice 1 (rename of `native_enum OrderStatus` used in `pg.enum(OrderStatus)`) passes after the simplification.

## Open Questions

None.

## References

- Parent project: `projects/lsp-rename/spec.md`
- ADR 262 (block specs bind top-level block values): the binder binds reference-kinded arguments; an unresolved reference is reported once, by the binder.
- `packages/1-framework/2-authoring/psl-parser/README.md` § Binder: the binder resolves names; interpretation checks how a resolved name is used.
- Operator decisions of 2026-10-08: the binder reads the existing `entityRefArg`; references across namespaces are to work; the named-type form is to be bound and to work.
