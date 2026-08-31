# ADR 231 — Declarative attribute specifications: composable argument combinators with typed inference

**Status:** Accepted
**Date:** 2026-06-29
**Accepted:** 2026-08-27

---

## At a glance

A PSL attribute carries positional and named arguments whose grammar must be validated before the family interpreter can lower them into a contract. That grammar is declared once as an `AttributeSpec`:

```ts
const sqlRelation = fieldAttribute('relation', {
  positional: [{ key: 'name', type: optional(str()) }],
  named: {
    name: optional(str()),
    fields: optional(list(fieldRef('self'), { nonEmpty: true })),
    references: optional(list(fieldRef('referenced'), { nonEmpty: true })),
    map: optional(str()),
    onDelete: optional(
      oneOf(
        identifier('NoAction'),
        identifier('Restrict'),
        identifier('Cascade'),
        identifier('SetNull'),
        identifier('SetDefault'),
      ),
    ),
  },
  refine: relationInvariants,
});
```

`interpretAttribute(node, sqlRelation, ctx)` parses the attribute's existing `ExpressionAst` nodes and returns either a value whose shape is inferred from the spec or structured diagnostics. The interpreter consumes the inferred value without maintaining a second argument-shape interface.

The same declarative shape is intended to become the source for language-tooling features. That second consumer is follow-up work: the accepted implementation establishes interpreter-owned specs and the typed parsing substrate, but does not yet provide central registration or a fully traversable combinator graph for the language server.

---

## Decision

Field- and model-level PSL attributes are described by family-owned declarative `AttributeSpec` values composed from a fixed kit of argument combinators in `psl-parser`. A shared `interpretAttribute` engine binds positional and named arguments, invokes each combinator against the parser's existing AST, applies optional defaults and cross-argument refinement, and returns a spec-derived output value or diagnostics.

The SQL and Mongo family interpreters are the first consumers. They define their built-in specs locally and pass them explicitly to `interpretAttribute`; contributed SQL model attributes may provide their own specs through the existing contribution mechanism. A central registry for all built-in specs and language-server consumption are not part of this implementation.

The kit consumes `ExpressionAst` directly. No intermediate argument representation is introduced, and no combinator reparses flattened source text except `json()`, the deliberate quoted-JSON-object exception.

Attributes are a PSL authoring concern, so the kit lives in `psl-parser` rather than framework core. The current constructors cover field and model attributes. `AttributeLevel` reserves a block level, but generic-block attribute construction and interpretation remain future work.

---

## Design principles

1. **The spec is the argument grammar.** A migrated attribute has one declarative description of its accepted positional and named arguments. Hand-written parsing for the same shape is removed.
2. **The spec derives the output type.** Constructors compute the output object from their positional and named parameters, and `InferAttr<S>` extracts it. Validation and the interpreter-facing type therefore evolve together.
3. **Compose instead of adding domain-specific leaves.** Native collections, alternatives, references, pinned literals, and typed function calls compose richer grammars such as defaults and Mongo index elements.
4. **Use native PSL literals for known structure.** Lists and records use `[…]` and `{…}`. A quoted string survives only for an arbitrary JSON object that the framework deliberately treats as opaque.
5. **Keep leaf parsing diagnostic-pure.** Every combinator returns a `Result`; it does not mutate a shared diagnostic sink. `oneOf` can therefore discard failed branches safely.
6. **Keep semantics at the right level.** A rule spanning arguments of one attribute belongs in `refine`. A rule spanning several attributes or entities remains in family-level semantic aggregation.
7. **Preserve future inspectability without claiming it already exists.** Specs expose their top-level argument structure and combinator kinds. Language tooling will require child combinators, function signatures, and reference metadata to become fully traversable.

---

## Core types

An argument combinator parses one `ExpressionAst` into `T`:

```ts
interface ArgType<T> {
  readonly kind: string;
  readonly label: string;
  readonly _out?: T;
  parse(arg: ExpressionAst, ctx: InterpretCtx): Result<T, readonly PslDiagnostic[]>;
}
```

The context contains the source and family symbols needed by the shipped reference combinators:

```ts
interface InterpretCtx {
  readonly level: 'field' | 'model' | 'block';
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly selfModel: ModelSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
  readonly field?: FieldSymbol;
}
```

A spec fixes the attribute level and name, declares its arguments, and may refine the parsed result:

```ts
interface AttributeSpec<Out> {
  readonly level: 'field' | 'model' | 'block';
  readonly name: string;
  readonly positional: readonly PositionalParam[];
  readonly named: Readonly<Record<string, Param<unknown>>>;
  readonly refine?: (
    parsed: Out,
    ctx: InterpretCtx,
    attributeNode: AstNode,
  ) => readonly PslDiagnostic[];
}
```

`fieldAttribute` and `modelAttribute` infer `AttributeOut<Pos, Named>` when constructing a spec. `InferAttr<S>` extracts that `Out` type. Optional parameters are `ArgType` values decorated by `optional(type)` or `optional(type, defaultValue)`; the engine detects the marker when finalizing absent arguments.

Positionals are fixed slots with an output key. Variadic positionals are not supported. Positional and named parameters may intentionally share a key, which supports the relation-name alias while allowing the engine to diagnose conflicting duplicate values.

---

## The combinator kit

### Scalars and pinned literals

- `str()` parses any string literal; `str(value)` matches one exact string and preserves its literal type.
- `num()` parses any number literal; `num(value)` matches one exact number and preserves its literal type.
- `int({ min, max })` parses an integer with optional inclusive bounds.
- `bool()` parses a boolean literal.
- `identifier(name)` matches one exact bare identifier and preserves its literal type.

There is no enum-specific combinator. A fixed vocabulary is a `oneOf` over pinned matchers, making the source spelling explicit:

```ts
oneOf(
  num(1),
  num(-1),
  str('text'),
  str('2dsphere'),
  str('2d'),
  str('hashed'),
)
```

These leaves perform direct AST checks. They do not wrap arktype schemas.

### References

`fieldRef('self')` parses a field-name identifier and validates it against the declaring model. `fieldRef('referenced')` validates against the relation target when that model can be resolved; cross-space references may defer the existence check when no referenced model is locally available. Both forms return the authored field name as a string and expose their scope as combinator metadata.

`entityRef()` parses an unresolved model-name string. Existence and family semantics remain downstream concerns.

The current kit does not return declaration-bearing entity coordinates, provide a document-path scope, or include a codec reference combinator. Those would be separate additions if a future consumer requires them.

### Native collections

`list(of, { nonEmpty, unique })` parses a native array literal, applies the element combinator to every item, and may enforce non-emptiness and uniqueness.

`record(of)` parses a native object literal into `Record<string, T>`, rejects duplicate keys, and applies `of` to each value. Keys are strings; the kit does not currently provide a generic `map(key, value)` combinator.

Mongo text-index weights demonstrate the shipped record shape:

```ts
record(int({ min: 1, max: 99_999 }))
```

### Quoted JSON object

`json()` accepts a quoted JSON string only when it decodes to a non-null, non-array object. It returns `Record<string, unknown>`.

This is intentionally narrower than an arbitrary JSON value. Its shipped use is Mongo's partial index filter, whose nested document is passed through rather than interpreted as a typed PSL record.

### Alternatives

`oneOf(first, ...rest)` tries its alternatives in order and returns the first success. If every alternative fails, it discards the branch diagnostics and emits one aggregate `Expected one of: …` diagnostic assembled from the alternatives' labels.

This trade-off keeps the leaf contract small and allows backtracking, at the cost of less specific diagnostics for malformed input that resembles one particular branch.

### Typed function calls

`funcCall(name, signature)` matches one unqualified function name and parses its positional and named arguments through the same parameter-binding engine used by attributes:

```ts
interface FuncCallSig {
  readonly positional?: readonly PositionalParam<unknown>[];
  readonly named?: Readonly<Record<string, Param<unknown>>>;
}

interface TypedFuncCall {
  readonly fn: string;
  readonly span: PslSpan;
  readonly args: Readonly<Record<string, unknown>>;
}
```

Function arguments may use any combinator, including nested `funcCall` values. Namespaced names are rejected at the function-call boundary.

The result is typed as a normalized function-call envelope, not as a name-literal-discriminated or signature-derived object. `funcCallFrom` and an unpinned raw function-call combinator are not part of the design.

---

## Dynamic specifications

A spec may be assembled from context known by the owning family before interpretation. This preserves a declarative grammar while allowing the accepted alternatives to reflect registries, enum members, or model fields.

### SQL defaults

SQL constructs `@default` specs per field. Scalar fields accept flexible string, number, and boolean literals plus one pinned `funcCall(name, signature)` arm for every active default-function registry entry. List fields accept a list of those scalar literals plus the registry calls. Enum fields use one pinned `identifier(member)` arm per enum member.

```ts
const functionArms = registryEntries.map(([name, entry]) =>
  funcCall(name, entry.signature),
);

const scalarDefault = oneOf(str(), num(), bool(), ...functionArms);
const enumDefault = oneOf(...enumMembers.map(identifier));
```

Literal-to-codec compatibility remains a lowering concern. A `matchingScalarLiteral` combinator is not implemented.

### Mongo index elements

Mongo constructs its index field-element grammar from the declaring model's field names:

```ts
const sortSig = {
  named: { sort: oneOf(identifier('Asc'), identifier('Desc')) },
} satisfies FuncCallSig;

const indexFieldElement = oneOf(
  fieldRef('self'),
  funcCall('wildcard', {
    positional: [{ key: 'scope', type: optional(entityRef()) }],
  }),
  ...fieldNames.map((name) => funcCall(name, sortSig)),
);
```

This composition covers bare fields, sorted field calls, and wildcard calls without dedicated `sortedFieldRef` or `wildcardPath` combinators.

---

## Cross-argument refinement

`refine(parsed, ctx, attributeNode)` runs after every argument has parsed successfully. It handles rules that no single argument can express and may anchor diagnostics to the complete attribute node.

Examples include relation arguments that must appear together and SQL or Mongo index constraints involving several options. Rules spanning multiple attributes, such as allowing at most one Mongo text index per collection, remain in the model-level semantic aggregation above individual attribute interpretation.

---

## Surface policy: native literals with one text exception

Known structured shapes use native PSL literals so the parser owns their structure and spans:

```prisma
@@index([wildcard()], include: ["metadata", "nested.path"])
@@textIndex([title, body], weights: { title: 10, body: 5 })
```

A Mongo partial-filter expression remains quoted JSON:

```prisma
@@index([status], filter: "{\"status\": {\"$ne\": \"archived\"}}")
```

The distinction is semantic: projections and weights have a known grammar the spec can describe, while the filter is an arbitrary nested Mongo document that the interpreter passes through.

---

## Language-tooling follow-up

The interpreter implementation proves that attribute grammars can be represented as values and consumed without hand-written argument parsing. It does not yet make those values a complete language-server API.

A language-tooling consumer will require additional work:

- a central way to discover built-in and contributed specs by level and attribute name;
- traversable child metadata for `list`, `record`, `oneOf`, and `funcCall`, whose children are currently captured by parse closures;
- reference metadata and resolution results sufficient for go-to-definition and find-usages;
- completion and hover behavior over named arguments, pinned alternatives, and nested function signatures;
- diagnostics parity tests between editor and interpreter consumers.

These additions should extend the declarative values rather than create a second attribute grammar. Language-server integration remains a separate delivery scope.

---

## Removed storage-type attribute channel

Storage types are authored through type-position constructors rather than `@db.*` named-type attributes: `@db.Uuid` becomes `Uuid`, and `@db.VarChar(191)` becomes `VarChar(191)`. Because storage selection is not an attribute surface, this design requires no named-type exception. ADR 241 records the constructor channel.

---

## Consequences

SQL and Mongo attribute argument grammars now live in family-owned specs, and migrated interpreter paths consume typed values from the shared engine. Repeated parsing concerns—argument binding, optional defaults, unknown names, duplicate values, native collection traversal, alternatives, and function-call signatures—are implemented once in `psl-parser`.

The interpreter-facing output type cannot independently drift from the spec because constructors derive it from the same positional and named parameter declarations.

Dynamic composition keeps open registries and document-specific vocabularies declarative. Families build `oneOf` alternatives from the registry, enum, or model context they own instead of adding registry-specific framework combinators.

The cost is a new vocabulary and a deliberate distinction between parsing and semantic validation. Contributors must decide whether a rule belongs in one combinator, attribute-level refinement, or family-level aggregation.

The current implementation is sufficient for interpreter consumption but not yet for language tooling. Accepting this ADR commits future consumers to extend and inspect the same specs rather than re-derive attribute grammars elsewhere.

---

## Follow-up work

- Add central spec discovery and traversable combinator metadata for language-tooling consumers.
- Decide whether reference combinators should expose declaration-bearing results while preserving the interpreter's string-oriented lowering needs.
- Add block-level construction and interpretation if generic-block attributes adopt this mechanism.
- Revisit signature-derived `TypedFuncCall` output types if downstream code needs statically discriminated call unions.
- Decide whether literal-to-field-type compatibility should remain in lowering or gain a dedicated field-context combinator.

---

## Alternatives considered

**Keep hand-written validation per attribute.** Rejected because it duplicates argument binding and parsing across families, allows output types to drift from validation, and leaves no reusable grammar value for future consumers.

**Use a dedicated enum combinator.** Rejected in favor of `oneOf` over pinned `identifier`, `str`, and `num` matchers. Composition supports homogeneous and mixed literal sets while making each member's source spelling explicit.

**Provide registry-specific function-call combinators.** Rejected because a family with a registry can build `oneOf(funcCall(name, signature), …)` directly. `funcCallFrom` would duplicate composition already available to the owner of the registry.

**Keep an unpinned raw function-call parser.** Rejected because it accepts names and argument shapes before the owning registry has described them, forcing validation back into lowering. Pinned typed calls reject unknown names and malformed arguments at the grammar boundary.

**Add bespoke sorted-field and wildcard-path combinators.** Rejected because model-specific `funcCall` arms compose those shapes from the existing kit.

**Use quoted strings for lists and records.** Rejected for known structure because native literals preserve AST structure, spans, diagnostics, and future completion opportunities. Quoted JSON remains only for an opaque object.

**Provide a generic `map(key, value)` immediately.** Deferred because current consumers require only string-keyed records. A generic key combinator can be added when a concrete attribute grammar needs it.

**Express the entire spec in arktype.** Rejected because arktype validates JavaScript values rather than PSL AST nodes with source spans and interpretation context. Direct combinators own AST recognition, diagnostics, and model-aware resolution.

---

## References

- [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)
- [ADR 224 — Control Policy: framework-locked vocabulary and family-owned dispatch](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)
- [ADR 221 — Contract IR: two planes with a uniform entity coordinate](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md)
- [ADR 241 — Scalar types use the authoring type-constructor channel](ADR%20241%20-%20Scalar%20types%20use%20the%20authoring%20type-constructor%20channel.md)
- [Pattern: Frozen-class AST + visitor](../patterns/frozen-class-ast.md)
- [Pattern: Three-layer polymorphic IR](../patterns/three-layer-polymorphic-ir.md)
