# Slice: mixin-inclusion

Parent project `projects/psl-mixins/`. Outcome this slice contributes: mixins work. An inclusion places the mixin's members in the enclosing block, and the emitted contract equals the contract of the same schema written inline.

## At a glance

`buildSymbolTable` gains mixin symbols and replaces each inclusion with the mixin's members at the inclusion's position. The binder binds each mixin body once, where it is written, and records what each inclusion's name refers to. Family interpreters are not changed. The "Mixins are not supported yet" diagnostic is removed.

## Chosen design

### Symbol table

**Mixin symbols.**

```ts
export interface MixinSymbol {
  readonly kind: 'mixin';
  readonly name: string;
  readonly keyword: string;
  readonly node: MixinDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly entries: readonly KeyValuePairAst[];
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}
```

`TopLevelScope` and `NamespaceSymbol` gain a `mixins` record. A mixin's name takes part in the existing duplicate-name check with models, composite types and blocks of the same namespace (`PSL_DUPLICATE_DECLARATION`, first wins). A mixin whose keyword is `model` or `type` has `fields`; any other keyword has `entries`.

**Replacing inclusions.** After every declaration in every document is collected, a second pass visits each model, composite type and generic block that has inclusions and rebuilds its member records in source order, with each inclusion replaced by the mixin's members:

| Record | What an inclusion contributes | Order |
|---|---|---|
| `fields` (models, composite types) | the mixin's `FieldSymbol` objects | at the inclusion's position among the fields |
| `entries` (generic blocks, enums) | the mixin's `KeyValuePairAst` nodes | at the inclusion's position among the entries |
| `attributes` | the mixin's resolved attributes | at the inclusion's position among the block's attributes |

Mixed-in members are the mixin's own objects, shared by every including block. They are not copied.

**Looking up the name.** An unqualified name is looked up in the including block's namespace, then at the top level. `ns.Name` is looked up in namespace `ns` only. The symbol table and the binder use one lookup, so they cannot disagree. Lookup is kind-blind, as for every other reference.

**Diagnostics raised here, all located at the inclusion:**

| Situation | Code | Message |
|---|---|---|
| The name resolves to nothing | `PSL_UNRESOLVED_REFERENCE` | `Cannot find mixin "<written>"` |
| The name resolves to something that is not a mixin | `PSL_UNRESOLVED_REFERENCE` | `"<written>" is a <kind>, not a mixin` |
| The name has a contract-space qualifier (`space:ns.Name`) | `PSL_UNRESOLVED_REFERENCE` | `A mixin cannot be included from another contract space` |
| The mixin's keyword differs from the block's | the block's member code (`PSL_INVALID_MODEL_MEMBER` or `PSL_INVALID_EXTENSION_BLOCK_MEMBER`) | `Mixin "<name>" is for "<mixin keyword>" blocks, not "<block keyword>" blocks` |
| The same mixin is included twice in one block | the block's member code | `Mixin "<name>" is already included in this block`; the second inclusion contributes nothing |
| A field name, or an entry key, is already present in the block when the inclusion is reached | `PSL_DUPLICATE_DECLARATION` | `Mixin "<name>" provides "<member>", which "<block name>" already has`; the earlier member is kept and the mixin's other members are still included |
| An inclusion inside a mixin body | the body's member code | `A mixin cannot include another mixin` |

When a block's own member comes after the inclusion that already provided the same name, the existing duplicate diagnostic at that member is reported instead, unchanged.

Entry keys are checked here because block-spec interpretation rejects a repeated key in both struct and map mode (`PSL_EXTENSION_DUPLICATE_PARAMETER`), so a repeated key is an error for every generic block. Dropping the duplicate here keeps that later check from reporting it a second time.

Attributes are not checked for duplicates here. Whether two `@@index` or two `@@map` attributes are allowed is each interpreter's rule, and those diagnostics stay at the attribute, in the mixin (project decision 13).

### Binder

- **A mixin body is bound once.** The binder walks mixins as it walks models: field types are resolved in the mixin's own namespace, and field names in the mixin's attributes are looked up in the mixin's own `fields`. This runs whether or not anything includes the mixin.
- **An including block binds only the members written in it.** Mixed-in members are skipped, so no member is bound twice and no binder diagnostic is repeated per including block.
- **A block's own attributes see all of its fields.** `@@unique([tenantId, id])` written in a model resolves `tenantId` to the mixin's field symbol.
- **An inclusion's name is a reference.** `symbolForNode` on the inclusion's `QualifiedName` returns `{ kind: 'mixin', symbol, namespace? }`, and the qualifier segment resolves to its namespace as for type references. `declaredSymbol` on a mixin declaration's node returns the `MixinSymbol`.
- **A mixin name in type position is rejected** the way a namespace name is today: `PSL_UNRESOLVED_REFERENCE`, `"<written>" is a mixin; a type reference must name a model, composite type, enum, or named type`.

- **The binder passes the mixin itself as the owner.** `AttributeSpecContext.model`, `UnsupportedAttribute.owner` and `UnresolvedTypeReference.owner` are widened to accept a `MixinSymbol`. No object shaped like a model is built around a mixin.
- **The family callbacks word their messages for a mixin.** `describeUnsupportedAttribute` (SQL and Mongo) and `describeUnresolvedType` (Mongo) say `Mixin "<name>"` where they say `Model "<name>"` for a model. For a mixin whose keyword is `type`, they do what they do for a composite type. This is a wording change only; interpretation never receives a mixin.

How the binder tells a block's own members from mixed-in ones is the implementer's choice, with one constraint: family interpreters, attribute specs and block specs are not given a way to ask.

### What does not change

- No file under `packages/2-sql`, `packages/2-mongo-family` or `packages/3-*` changes in `src`, other than the two diagnostic-wording callbacks above and a compile fix if a type they import gains a member.
- An interpreter error on a mixed-in member is reported once per including block, at the member in the mixin (project decision 13 and non-goals).

## Coherence rationale

Placing members and binding them correctly are one change: placing them without the binder change resolves a mixin's field types once per including block in that block's namespace, which is exactly the behaviour project decision 10 rules out. A reviewer needs both halves to judge either.

## Scope

**In:**

- `psl-parser`: `symbol-table.ts`, `scope.ts`, `binder.ts`, their tests, removal of the interim diagnostic and its tests, and the README sections on the symbol table, scope chain and resolution kinds.
- Contract-equivalence tests in the SQL `contract-psl` package for `model`, `type`, `enum` and an extension `key = value` block, plus the field-order test. One equivalence test in the Mongo `contract-psl` package for a model mixin.
- A test for the row-level security example from the project spec, in the package that owns `policy_select`.
- The user-facing PSL authoring skill, with a short section on mixins.

**Out:**

- Completion after `+`, completion and signature help inside a mixin body, semantic tokens for mixin bodies, `fieldTakesMap` in `rename.ts` returning false for a mixin's field, and the completion provider not counting mixed-in keys as present. All are `mixin-editor-support`.
- De-duplicating interpreter diagnostics. A warning for a mixin nothing includes.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A mixin in namespace `auth` has `owner User`; it is included in a model in namespace `billing`, which has its own `User` | `owner` refers to `auth.User` in the emitted contract | The test that shows the interpreters read the binder's resolution and do not look the name up again in the including model's namespace. If an interpreter does look it up again, halt: that is a change outside this slice's scope. |
| A mixin's attribute names a field the mixin does not declare | `PSL_UNRESOLVED_REFERENCE` at the argument, in the mixin, once | Project Definition of Done item. |
| A model's `@@id([tenantId, id])` where `tenantId` comes from a mixin | Resolves; contract equals inline | |
| `buildField`'s `ownerName` appears in the `PSL_INVALID_QUALIFIED_TYPE` message | For a mixin's field the owner named is the mixin | |
| Two documents: the mixin in one file, the including model in another | Works; diagnostics at the inclusion carry the including file's name | The second pass runs after all documents are collected. |
| An `enum` mixin whose member carries `@map` | The member keeps its attribute in the including enum | Entries are shared nodes. |

## Slice-specific done conditions

- [ ] For `model`, `type`, `enum` and an extension block: the contract emitted for a schema using a mixin deep-equals the contract for the same schema written inline.
- [ ] Field order in the emitted contract follows the inclusion's position (inclusion first, in the middle, last).
- [ ] Each row of the diagnostics table has a test asserting code, message and location.
- [ ] A schema with one mixin included by three models reports each binder diagnostic about the mixin body once.
- [ ] No string "not supported yet" about mixins remains in `packages`.
- [ ] `git diff` for the slice shows no change under `packages/2-sql/**/src`, `packages/2-mongo-family/**/src` or `packages/3-*/**/src` beyond compile fixes and the wording of the two family diagnostic callbacks.
- [ ] An unsupported attribute in a `model` mixin is reported once, in the mixin, with a message that says `Mixin`; the same in a `type` mixin is reported the way it is for a composite type, and not a second time by the binder.

## Open Questions

None.

## References

- Parent project: `projects/psl-mixins/spec.md` (decisions 5 to 13)
- `packages/1-framework/2-authoring/psl-parser/README.md`
- The `psl-ast-layers` skill
