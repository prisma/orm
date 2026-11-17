---
from: "8.0.0-rc.8"
to: "8.0.0-rc.9"
changes:
  - id: remove-nested-relations-from-sql-orm-upsert-and-batch-create
    summary: |
      SQL ORM `upsert({ create })`, `createAll()`, and `createAndCount()` payloads no longer accept nested relation mutation callbacks, which these operations cannot execute. Remove the callbacks and create related records separately, or use ordinary `create()` when the records must be created as one nested relation operation.
  - id: namespace-qualify-sql-orm-filter-types
    summary: |
      SQL ORM reusable filter types now require the domain namespace before the model name: `<Contract, Namespace, Model>`.
  - id: add-attributes-to-psl-extension-block-literals
    summary: |
      `PslExtensionBlock` gained a required `attributes` record (attribute name → `{ args, span }`, the kit-parsed values of the block's `@@` attributes). Every hand-built block node — synthesised blocks in scripts, inference builders, and test fixtures — must set `attributes` next to `blockAttributes` (`{}` when the block carries no attributes).
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "blockAttributes:"
      anyMatch: true
  - id: read-native-enum-map-failures-from-the-kit
    summary: |
      `PSL_NATIVE_ENUM_INVALID_MAP` no longer exists. A malformed `@@map` on a `native_enum` block — and every other malformed block attribute — is reported at symbol-table time as `PSL_INVALID_ATTRIBUTE_SYNTAX`; only the policy `@@map("")` empty-name rule keeps its own code (`PSL_POLICY_INVALID_MAP`). Replace references to the removed code and assert those diagnostics on the `buildSymbolTable` result rather than on the interpretation result.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "PSL_NATIVE_ENUM_INVALID_MAP"
      anyMatch: true
  - id: arg-type-parse-is-a-property
    summary: |
      `ArgType.parse` is now a property function type carrying a `Ctx` parameter, so the ctx an argument type needs is checked contravariantly. A class that implements `ArgType` with a `parse(...)` method, or an object typed against `ArgType<T>` and used inside `blockAttribute()`, must declare `parse` as a function-typed property over the ctx it actually reads.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "implements ArgType"
        - "ArgType<"
      anyMatch: true
  - id: state-attribute-spec-contexts-explicitly
    summary: |
      The attribute-spec interpret contexts were reshaped. `BlockInterpretCtx` and `InterpretCtx` are gone, replaced by `AttributeCtx` (`sourceId` + `sourceFile`), `ModelAttributeCtx` (adds `selfModel`), and `FieldAttributeCtx` (adds a required `field` and `resolveReferencedModel()`). Contexts no longer carry `level`. `ArgType`, `OptionalArgType`, `Param`, `PositionalParam`, and `AttributeSpec` lost their default type arguments, so every use site must name its context. `fieldRef('self')` / `fieldRef('referenced')` became `fieldRef()` / `referencedFieldRef()`, and `FieldRefScope`, `FieldRefArgType`, and the `scope` property are removed. `oneOf` is one generic signature over a single context shared by every alternative, so a mixed alternation must be given that context by an annotation or a contextual type.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "InterpretCtx"
        - "fieldRef("
        - "FieldRefScope"
        - "FieldRefArgType"
        - "ArgType<"
        - "AttributeSpec<"
        - "PositionalParam"
      anyMatch: true
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — Extension author upgrade instructions

## `remove-nested-relations-from-sql-orm-upsert-and-batch-create`

Find SQL ORM calls to `upsert()`, `createAll()`, and `createAndCount()` whose create payloads contain relation fields assigned callback functions. Remove those callbacks and create the related records separately. When the operation requires nested relation creation, replace it with ordinary `create()`, which continues to accept and execute relation mutation callbacks.

## `namespace-qualify-sql-orm-filter-types`

Find TypeScript references to `ShorthandWhereFilter`, `RelationPredicate`, `RelationPredicateInput`, and `RelationFilterAccessor`. Add the model's domain namespace as the second generic argument and place the model name third. Rewrite `ShorthandWhereFilter<Contract, Model>` as `ShorthandWhereFilter<Contract, Namespace, Model>` and `ShorthandWhereFilter<Contract, Model, Namespace>` as `ShorthandWhereFilter<Contract, Namespace, Model>`. Rewrite the relation types from `<Contract, Model>` to `<Contract, Namespace, Model>`. For predicates targeting a relation, use the namespace declared by that relation's `to.namespace` coordinate.

## `add-attributes-to-psl-extension-block-literals`

Find every object literal typed as `PslExtensionBlock` (they carry `kind`, `keyword`, `name`, `parameters`, `blockAttributes`, `span`). Add `attributes` beside `blockAttributes`. A block with no `@@` attributes takes `attributes: {}`. A block synthesised with a `blockAttributes` entry takes the parsed shape of that entry, keyed by attribute name with the spec's positional keys as `args` — for example a synthesised `@@map("x")` on a `policy_*` or `native_enum` block becomes `attributes: { map: { args: { name: 'x' }, span } }`. Consumers that read a block attribute read `block.attributes[name]?.args`, never `block.blockAttributes`.

## `read-native-enum-map-failures-from-the-kit`

Delete every reference to `PSL_NATIVE_ENUM_INVALID_MAP`. Where a test asserted that code after interpreting a document, parse the document and assert `PSL_INVALID_ATTRIBUTE_SYNTAX` on the diagnostics `buildSymbolTable` returns instead; interpretation no longer sees a malformed block attribute. A `@@map(foo)` argument reports `Expected a string literal`; a missing argument reports `Attribute "map" is missing required argument "name"`.

## `arg-type-parse-is-a-property`

Find classes declaring `implements ArgType<…>` with a `parse(arg, ctx)` method and object literals typed against `ArgType<T>`. Declare `parse` as a property whose type is `(arg: ExpressionAst, ctx: Ctx) => Result<T, readonly PslDiagnostic[]>`. Pick the narrowest `Ctx` the implementation actually reads, as the next entry describes. Dispatch on the syntax node with `XAst.cast(arg.syntax)` rather than `arg instanceof XAst` so the argument type keeps working when the spec and the parser come from different module copies.

## `state-attribute-spec-contexts-explicitly`

**Rename the context types.** `BlockInterpretCtx` becomes `AttributeCtx`. `InterpretCtx` splits: use `ModelAttributeCtx` where the code reads `selfModel` and nothing else, and `FieldAttributeCtx` where it reads `field` or `resolveReferencedModel()`. Both are exported from `@internal/psl-parser`.

**Drop `level` from every context value.** A hand-built ctx object that set `level: 'field' | 'model' | 'block'` must delete that property; contexts no longer declare it. `AttributeSpec.level` is a different field and is unchanged — keep setting and reading it.

**Move `resolveReferencedModel` down to the field level.** A model-level ctx must no longer supply it. The `resolveReferencedModel: () => undefined` stub that model-level ctx builders carried is now a type error; delete it. A field-level ctx must supply both `field` (previously optional, now required) and `resolveReferencedModel()`.

**Name a context at every use site.** `ArgType<T>`, `OptionalArgType<T>`, `Param<T>`, `PositionalParam<T>`, and `AttributeSpec<Out>` no longer default their second type argument. Rewrite each as `ArgType<T, AttributeCtx>` when the combinator reads only `sourceId` / `sourceFile`, `ArgType<T, ModelAttributeCtx>` when it reads `selfModel`, and `ArgType<T, FieldAttributeCtx>` when it reads `field` or `resolveReferencedModel()`; the same choice applies to the other four. `PositionalParam` also lost its `T = unknown` default, so a bare `PositionalParam` becomes `PositionalParam<unknown, Ctx>`. Prefer the widest context that still typechecks: a spec parameter over `AttributeCtx` is usable inside `blockAttribute()`, `modelAttribute()`, and `fieldAttribute()` alike.

**Split the field reference combinator.** Replace `fieldRef('self')` with `fieldRef()` and `fieldRef('referenced')` with `referencedFieldRef()` (imported from `@internal/psl-parser`). `fieldRef()` is typed over `ModelAttributeCtx` and stays usable in model attributes such as `@@index`; `referencedFieldRef()` is typed over `FieldAttributeCtx` and is accepted only in field attributes. The `FieldRefScope` and `FieldRefArgType` types and the `scope` property on the returned combinator are removed — a test asserting `fieldRef('self').scope` has no replacement; assert on the parse behaviour or on `label` instead.

**Give `oneOf` one context for all of its alternatives.** `oneOf` is now a single generic signature: the output is the union of the alternatives' outputs, and every alternative parses over the same context. An alternation whose alternatives all read only `sourceId` / `sourceFile` — `str()`, `num()`, `bool()`, `identifier()`, `json()`, `entityRef()`, `funcCall()` — needs nothing; its context is `AttributeCtx` and it stays usable at every level. An alternation that mixes those with a model-scoped or field-scoped alternative such as `fieldRef()` must be told which context it parses over, because `oneOf` no longer computes one from the alternatives. Supply it from the surrounding code: annotate the result (`const arm: ArgType<string, ModelAttributeCtx> = oneOf(str(), fieldRef())`), annotate the alternatives tuple before spreading it into `oneOf(...arms)`, or let the enclosing function's return type provide it. Such an alternation remains rejected inside `blockAttribute()`.
