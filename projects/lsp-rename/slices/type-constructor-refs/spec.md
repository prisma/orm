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

### SQL interpreter (`packages/2-sql/2-authoring/contract-psl`)

`resolveEntityRefTypeConstructorCall` stops looking the name up in `namespaceExtensionEntities` by text.

- **Entity by symbol.** Lowering extension blocks also fills a map from `BlockSymbol` to what was lowered from it: the entity, its discriminator, its namespace id, its name, and whether a value set was derived. It is the counterpart of the existing `enumTypeDescriptors` map for family `enum` blocks.
- **Reading the resolution.** The interpreter reads `binder.symbolForNode` on the argument's node:

| Resolution on the argument | Result |
|---|---|
| a block that was lowered to an entity of the constructor's `entityKind` | the column, as today |
| `unresolved` | no diagnostic: the binder reported it |
| a block that is registered but was not lowered | no diagnostic: its own diagnostics were reported |
| anything else (a model, a block of another kind, a namespace) | `PSL_UNKNOWN_ENTITY_REF`, saying what the name resolved to and what the constructor expects |
| none, because the argument is not a name | `PSL_INVALID_ATTRIBUTE_ARGUMENT`, the existing "expects exactly one positional argument naming the referenced entity" |

- **Arity checks and the missing `columnFromEntity` hook** keep their diagnostics.
- **A hook that rejects the entity** keeps `PSL_UNKNOWN_ENTITY_REF`, with a text that says the entity was found and is not accepted as a column type. Today's text says no entity of that name was found, which is no longer what happened.
- **The Prisma 7 interpreter** (`contract-prisma7/src/interpreter.ts`) has no syntax node for the name and no binder. The part of the function that turns a resolved entity into a column is split out and takes the resolved entity; the PSL path gets the entity from the binder, the Prisma 7 path from its own declaration. No entry point keeps the lookup by name.

### What the wider binder scope changes (transitional)

Today the interpreter finds an entity only in the namespace of the field's model. Binder scope differs in three ways; the operator decided on 2026-10-08 that references across namespaces are to work, and that is slice 3. In this slice:

| Schema | Today | After this slice |
|---|---|---|
| model in `namespace auth`, `pg.enum(X)`, `X` at top level | `PSL_UNKNOWN_ENTITY_REF` | resolved by the binder; the interpreter refuses it with `PSL_UNKNOWN_ENTITY_REF` naming both namespaces |
| `pg.enum(auth.X)` from a model outside `auth` | `PSL_UNKNOWN_ENTITY_REF` | the same refusal |
| `pg.enum(auth.X)` from a model inside `auth` | `PSL_UNKNOWN_ENTITY_REF` | works |
| model in `namespace public { }`, `X` at top level | works (both are `public`) | works |
| top-level model, `X` declared in `namespace public { }`, written unqualified | works (both are `public`) | `Cannot find entity "X"`; `public.X` works. A name inside a namespace is not in scope outside it, as for models |

Navigation and rename work in every row where the binder resolves the name, including the refused ones.

A named type over the constructor is bound by the binder and still fails interpretation with today's diagnostic (`accepts at most 0 argument(s)`); making it work is slice 4.

### Language server

No source change. Tests are added for go-to-definition, hover, find references and rename on a constructor argument, with a fixture constructor that declares `entityRefArg`. Completion inside constructor arguments stays unsupported.

## Coherence rationale

The binder change alone would produce two diagnostics for an unknown name (the binder's and the interpreter's), so the interpreter has to stop looking the name up in the same PR. The Prisma 7 caller shares the function being changed. The reviewer reads one binder addition, one interpreter function with its input map, and the split for Prisma 7.

## Scope

**In:** `psl-parser` binder and its tests; SQL `contract-psl` (`interpreter.ts`, `psl-column-resolution.ts`, `psl-field-resolution.ts` as needed) and its tests; `contract-prisma7` caller; Postgres target tests for `pg.enum` columns; language-server tests; the QA rerun of the `native_enum` rename.

**Out:**

- References across namespaces producing a column (slice 3): type-name qualification from the enum's namespace, `contract print`.
- A named type over an entity constructor producing a column (slice 4).
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
| Name resolves to a model with the enum's name in scope | `PSL_UNKNOWN_ENTITY_REF` from the interpreter, wording changed | Pinned today by `psl-pg-enum-column.test.ts` with the code only |
| Unknown name | One diagnostic, the binder's, on the argument; none from the interpreter | Two tests accepted `PSL_UNKNOWN_ENTITY_REF` loosely for this case; they now assert the full diagnostic list |
| `pg.enum("X")`, `pg.enum(1)` | `PSL_INVALID_ATTRIBUTE_ARGUMENT` | Today a text lookup misses and reports `PSL_UNKNOWN_ENTITY_REF` |
| Test that drives `resolveFieldTypeDescriptor` with a hand-built entity map | Rewritten to the symbol-keyed input | `interpreter.entity-ref-type-constructor.test.ts`, the no-namespace value-set case |
| Language-server completion tests with an undeclared `pg.enum(StatusValues)` | They gain a binder diagnostic; change them only if they assert on diagnostics | `completion-symbols.test.ts` |
| Composite type field | Bound with the composite type's scope; the interpreter compares against the default namespace, as it uses the default namespace's entities today | A value-set result there stays refused |
| Constructor with `entityRefArg` on a target with no namespaces | Unchanged: the existing no-namespace diagnostic | Only reachable in tests |

## Slice-specific done conditions

- [ ] A binder test per row of the binder outcomes and per binding place, including a namespaced model and a qualified name.
- [ ] The SQL interpreter contains no lookup of the argument's text: a grep for the entity map indexed by the written name in `psl-column-resolution.ts` returns nothing.
- [ ] For the existing same-namespace fixtures (Postgres target tests, the `native-enum` parity fixture), the emitted contract is unchanged; `pnpm fixtures:check` passes.
- [ ] A test per row of the transitional table.
- [ ] Language-server tests: go-to-definition, hover and find references from the argument; rename of a `native_enum`-like block from its declaration and from the argument edits both, and adds `@@map` once.
- [ ] The QA scenario that failed in slice 1 (rename of `native_enum OrderStatus` used in `pg.enum(OrderStatus)`, built CLI, Postgres target) passes: no diagnostics after applying the edit.

## Open Questions

1. Wording of the two refusals (wrong kind; another namespace). Working position: `Field "Order.status" type constructor "pg.enum(X)" names the model "X"; it expects a native_enum.` and `… names "X" of namespace "public"; in this version it can only name a native_enum of the model's namespace "auth".` The second one is removed by slice 3.

## References

- Parent project: `projects/lsp-rename/spec.md`
- ADR 262 (block specs bind top-level block values): the binder binds reference-kinded arguments; an unresolved reference is reported once, by the binder.
- `packages/1-framework/2-authoring/psl-parser/README.md` § Binder: the binder resolves names; interpretation checks how a resolved name is used.
- Operator decisions of 2026-10-08: the binder reads the existing `entityRefArg`; references across namespaces are to work; the named-type form is to be bound and to work.
