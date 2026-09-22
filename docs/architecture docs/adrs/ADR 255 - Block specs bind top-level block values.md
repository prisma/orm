# ADR 255 — Block specs bind top-level block values

**Status:** Accepted
**Date:** 2026-09-22
**Builds on:** [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md), [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md)

---

## At a glance

A contributed top-level PSL block declares its member-value grammar with the same argument combinators attributes use (ADR 231), through one of two binders. A closed key set is a `fixedBlock`; the Postgres `policy_select` keyword declares exactly the keys a SELECT policy takes:

```ts
import { entityRef, fixedBlock, identifier, list, oneOf, optional, str, bool } from '@internal/psl-parser';

export function policyUsingOnlySpec() {
  return fixedBlock({
    parameters: {
      target: {
        type: entityRef({ kind: 'model' }),
        documentation: 'The model protected by this policy; it must declare @@rls.',
      },
      roles: {
        type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
        documentation: 'The database roles to which this policy applies.',
      },
      using: {
        type: optional(str()),
        documentation: 'A SQL predicate controlling which rows this policy permits.',
      },
      permissive: {
        type: optional(bool()),
        documentation:
          'Whether the policy is permissive (combined with OR) rather than restrictive (combined with AND).',
      },
    },
  });
}
```

An arbitrary key set is an `entriesBlock`, one reusable rule applied to every member; the SQL family enum accepts native JSON-compatible literals and bare members:

```ts
import { entriesBlock, jsonValue } from '@internal/psl-parser';

export function sqlFamilyEnumSpec() {
  return entriesBlock({
    value: {
      type: jsonValue(),
      documentation: 'The stored member value; a bare member stores its own name.',
    },
    allowBare: true,
  });
}
```

`InferBlock` extracts the spec's output type, so the lowering factory's input is derived from the grammar rather than maintained by hand:

```ts
type EnumBlockValues = InferBlock<ReturnType<typeof sqlFamilyEnumSpec>>;
// Record<string, JsonValue | undefined> — undefined is the bare-member sentinel
```

The descriptor registers the spec factory next to the keyword it claims:

```ts
export const sqlFamilyPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    documentation:
      'Defines an enum with named values and an inferred or explicitly selected storage codec.',
    discriminator: 'enum',
    name: { required: true },
    spec: sqlFamilyEnumSpec,
    attributes: { type: () => enumTypeBlockAttribute },
  } satisfies PslBlockSpecDescriptor,
} as const satisfies AuthoringPslBlockDescriptorNamespace;
```

---

## Decision

Top-level extension blocks have one value grammar: a **block spec** built from the shared argument combinators. The spec is a factory — `(ctx: BlockSpecContext) => BlockSpec` with `BlockSpecContext = { symbols: SymbolTable; block: BlockSymbol }` — registered on the block's `AuthoringPslBlockDescriptor` as the `spec` field. Symbol-table construction first collects every declaration, then binds each registered block's spec and interprets the block's member expressions and `@@` attributes directly against the expression AST. Only blocks whose values and attributes all interpret successfully publish a **typed envelope** (`ParsedPslExtensionBlock`), and lowering consumes envelopes exclusively. The ordered source text of a block's members survives only as a **source/print representation** (`PslExtensionBlock`) for the printer and for inference producers; no validator, classifier, or lowering path reads it.

Two binders cover the block shapes PSL has:

- `fixedBlock({ parameters })` — a closed set of declared keys. Unknown keys are rejected; a key is required unless its rule is `optional(...)`. Required/optional property inference reuses the named-argument machinery (`NamedOut`), so a fixed spec's output type carries exactly the declared keys.
- `entriesBlock({ value, allowBare? })` — arbitrary keys, each bound through one shared value rule. With `allowBare: true`, a member may stand alone on its line; the output record then carries the key with an `undefined` value — the bare sentinel, distinct from an explicit JSON `null`.

`InferBlock<S>` extracts a spec's output type, and `jsonValue()` is the shared rule for native JSON-compatible literals (strings, numbers, booleans, `null`, arrays, object literals, recursively). It recognizes the expression AST directly; `json()`, which decodes a quoted JSON object string, remains the deliberate text exception (ADR 231).

### The descriptor carries the spec erased; the parser restores it

Framework core registers descriptors without importing parser types: `AuthoringPslBlockDescriptor.spec` is `unknown`, validated at registration as a function. The parser-facing `PslBlockSpecDescriptor` narrows `spec` to the real factory type, and authoring code declares descriptors with `satisfies PslBlockSpecDescriptor` so the field stays typed at the source. `blockSpecFactoryOf(descriptor)` is the single point that restores the callable type from the erased field. Core stays parser-independent; the parser owns the grammar vocabulary.

### Collect first, interpret second

`buildSymbolTable({ documents, sources, pslBlockDescriptors })` collects all declarations with stable symbol identities before any block is interpreted. Spec factories may therefore resolve references — forward references included — because the parse context always holds the complete symbol table. Reference rules (`entityRef`) derive lexical scope from the expression's syntax ancestry; `BlockSpecContext.block` serves attribute interpretation and metadata inspection, not reference resolution.

The result publishes the envelopes alongside the table:

```ts
export interface SymbolTableResult {
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
}
```

An invalid block has no `parsedBlocks` entry — its symbol keeps syntax and source provenance for recovery and editor tooling, but it cannot lower. An unregistered keyword is never interpreted and gains no grammar. Diagnostics have one owner: `buildSymbolTable` reports every value and attribute failure once, anchored to the original expression and entry spans; downstream consumers never re-validate.

Interpreter providers thread `SymbolTableResult.parsedBlocks` through `PslInterpretInput.parsedBlocks`. A direct interpreter caller that holds only a symbol table re-derives the same envelopes with `deriveParsedBlocks(symbolTable, sources, pslBlockDescriptors)`, which runs the identical spec pipeline and keeps only successes.

### The typed envelope

```ts
export interface ParsedPslExtensionBlock<Values = Readonly<Record<string, unknown>>> {
  readonly kind: string; // storage identity — the descriptor's discriminator
  readonly keyword: string; // parse identity — the source PSL keyword
  readonly name: string;
  readonly values: Values;
  readonly parameterSpans: Readonly<Record<string, PslSpan>>;
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly span: PslSpan;
}
```

The envelope is parser-independent (it is declared in framework core's shared plane) and generic over `Values`, so a concrete consumer can carry parser-owned results — a resolved model reference, a decoded literal — through the type parameter without core depending on those types. `parameterSpans` lets consumers anchor semantic diagnostics without reparsing; `attributes` are the block's interpreted `@@` attributes, produced by the same lifecycle (`resolveEnumCodecId`, for example, reads `block.attributes['type']` and `block.values`).

### Printing and inference use source provenance only

`PslExtensionBlock` holds ordered `parameters: Record<string, PslExtensionBlockSourceEntry>` — expression text and span per entry, a missing `expression` rendering as a bare line — plus generically captured `@@` attribute lines. The printer renders this shape without consulting descriptors, codecs, or JSON re-encoding. Inference producers (Postgres policy and native-enum inference) construct the same shape when synthesizing blocks from a live database, and round-trip tests parse and validate those documents through the actual spec pipeline. The two representations never cross: inference does not manufacture resolved symbols, and lowering never accepts printable entries.

### SQL files placement rows through an opt-in hook

SQL projects a block's already-selected model references onto storage coordinates once — `ResolvedPslModelRefs`, keyed by parameter name, carrying `{ namespaceId, tableName }` read from the selected declaration's identity, never from a second name lookup. An entity-type factory output may additionally implement the SQL-owned placement hook:

```ts
export interface SqlPslEntityPlacementOutput {
  pslPlacement(entity: unknown): Pick<LoweredPackEntity, 'namespaceId'>;
}
```

Outputs without the hook keep the block's lexical owner namespace. Postgres policies opt in with their target's coordinate, so a policy is filed at the namespace of the table it protects:

```ts
const policyEntityTypeOutput = {
  factory: lowerRlsPolicyFromBlock,
  pslPlacement: (entity: PostgresRlsPolicy) => ({ namespaceId: entity.namespaceId }),
} satisfies AuthoringEntityTypeFactoryOutput<RlsPolicyExtensionBlock, PostgresRlsPolicy | undefined> &
  SqlPslEntityPlacementOutput;
```

The hook picks only the destination namespace — entity kind and key stay fixed by the walk — and collision checks run at the destination, so two policies from different lexical namespaces that converge on one key still collide. The hook is SQL-family surface; framework entity factories keep their return contract, and no serialized format changes.

### Cross-declaration requirements stay declarative

`AuthoringPslBlockDescriptor.requiresModelAttribute: { parameter, attribute }` declares that the model selected by a ref parameter must carry a bare `@@` attribute (Postgres policies require `@@rls` on their target). The family interpreter enforces it generically over the whole document — declaration order does not matter — and anchors `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE` on the original parameter span.

---

## Consequences

- One grammar, three consumers. The spec a block validates against is the spec the language server inspects for key completion and documentation and the spec the lowering factory's input type derives from (`InferBlock`). None of the three can drift, because all three read the same value.
- Lowering paths receive decoded values and spans. Family enum lowering keeps codec selection, decoding, emptiness, and decoded-value-uniqueness checks — semantic concerns over typed values — while member recognition belongs to the grammar.
- Alternate producers construct envelopes, not text. A producer that already holds decoded values (an earlier Prisma version's schema reader, per ADR 252) builds a trusted `ParsedPslExtensionBlock` directly rather than synthesizing source for reparsing.
- Editor metadata binds specs with the same `{ symbols, block }` context. Fixed keys complete with their documentation; arbitrary-key blocks invent no candidates. Because binding a spec requires a declared block symbol, a snippet for a not-yet-written block cannot enumerate its keys; key completion begins once the block declaration exists.
- The cost is one more registration concept: a block author writes a spec factory instead of a parameter table, and decides per rule whether a constraint is grammar (a combinator or `optional`), block interpretation, or family semantics.

---

## Alternatives considered

**Describe parameters as data — a typed parameter table on the descriptor.** A descriptor-owned map of parameter kinds (`ref` / `value` / `option` / `list`) with a generic validator interpreting it. Rejected: a closed kind vocabulary cannot express the grammars blocks actually need — alternatives with checked-reference preference (`oneOf(entityRef(...), identifier())`), nested JSON literals, bare-member sentinels — so families grow hand-written validation beside the table, and the interpreter-facing types drift from the declared kinds. ADR 231's combinators already express these grammars with inferred output types; block values reuse them instead of maintaining a second, weaker description language. ADR 126's parameter-kind sections record the superseded shape.

**Carry block values through the codec JSON medium.** A `value` parameter naming a `codecId`, decoded during parsing. Rejected: codec choice for enum members is a family lowering concern over the decoded literal (an integer member may store through `int4` or `int8` depending on the target), and parsing must not depend on codec registries. The grammar recognizes native JSON literals (`jsonValue()`); codecs interpret them afterwards.

**Validate blocks from flattened source text.** Keeping raw expression strings on the parsed block and reparsing them in each consumer. Rejected: it duplicates the expression grammar in every consumer, loses spans, and makes diagnostics inconsistent. Source text survives strictly as print provenance.

**A variadic flag on fixed parameter tables.** Marking a descriptor as accepting arbitrary extra keys next to declared ones. Rejected: arbitrary-key blocks and closed-key blocks are different shapes with different output types; `entriesBlock` gives the former its own binder and inferred `Record` output instead of weakening unknown-key rejection for the latter.

**Injected reference resolvers in the spec context.** Passing a resolver object to spec factories. Rejected: the parse context already carries the symbol table, and reference rules derive lexical scope from syntax ancestry, so an injected resolver adds an owner without adding a capability.

---

## References

- [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md)
- [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md)
- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md)
- [ADR 253 — PSL red-root source ownership](ADR%20253%20-%20PSL%20red-root%20source%20ownership.md)
- [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version%27s%20schema%20is%20a%20contract%20source.md)
- [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)
