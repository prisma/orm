---
changes:
  - id: psl-block-descriptor-declares-a-spec-factory
    summary: |
      `AuthoringPslBlockDescriptor.parameters` and `variadicParameters` are removed.
      A block descriptor declares its member-value grammar as a `spec` factory built
      with `fixedBlock` / `entriesBlock` from `@internal/psl-parser`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'variadicParameters'
        - 'PslBlockParam'
  - id: block-factories-consume-typed-envelopes
    summary: |
      Entity-type factories for contributed blocks receive a typed
      `ParsedPslExtensionBlock` envelope. Read decoded values from `block.values`
      and interpreted `@@` attributes from `block.attributes`; never parse entry
      source text.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'PslExtensionBlockParam'
---

## `psl-block-descriptor-declares-a-spec-factory`

Rewrite each `kind: 'pslBlock'` descriptor:

1. Delete the `parameters` map and the `variadicParameters` flag.
2. Add a `spec` factory. A closed key set becomes `fixedBlock`; each old parameter entry becomes a key whose rule is an argument combinator (`str()`, `bool()`, `entityRef({ kind: 'model' })`, `list(...)`, `oneOf(...)`), wrapped in `optional(...)` when the old entry had `required: false`. Every key carries `documentation`.
3. A descriptor that accepted arbitrary member names (the old `variadicParameters: true`) becomes `entriesBlock({ value })` with one shared rule for every key; add `allowBare: true` if members may stand alone without `= value` (a bare member surfaces as `undefined` in the output record, distinct from JSON `null`).
4. Declare the descriptor with `satisfies PslBlockSpecDescriptor` (from `@internal/psl-parser`) so the `spec` and `attributes` fields stay typed at the source; the core registration type keeps them erased.

Old parameter kinds translate as:

| Old parameter kind | Rule |
| --- | --- |
| `{ kind: 'ref', refKind: 'model' }` | `entityRef({ kind: 'model' })` |
| `{ kind: 'ref', refKind: '<block keyword>' }` | `entityRef({ kind: 'block', keyword: '<keyword>' })`, or `oneOf(entityRef(...), identifier())` to also accept undeclared external names |
| `{ kind: 'value', codecId: 'String' }` | `str()` |
| `{ kind: 'option', values: [...] }` | `oneOf(identifier('a'), identifier('b'), ...)` |
| `{ kind: 'list', of: ... }` | `list(<element rule>)` |
| arbitrary JSON-compatible member values | `jsonValue()` |

## `block-factories-consume-typed-envelopes`

The `PslExtensionBlockParam*` value union is removed. A factory registered under a block's `discriminator` now receives `ParsedPslExtensionBlock<Values>` (from `@internal/framework-components/authoring`):

1. Type the factory input with the spec's inferred output instead of hand-written value interfaces: `type MyBlockValues = InferBlock<ReturnType<typeof myBlockSpec>>` and `ParsedPslExtensionBlock<MyBlockValues>`. Fixed-spec outputs have readonly properties; input types must accept readonly values.
2. Replace reads of parameter text or param-kind discriminants with `block.values.<key>` — values arrive decoded (strings, numbers, booleans, resolved references), so delete any `JSON.parse`, quote-stripping, or ref re-resolution in the factory.
3. Anchor diagnostics with `block.parameterSpans['<key>']` and read interpreted `@@` attributes from `block.attributes['<name>'].args`.
4. `PslExtensionBlock` (with `PslExtensionBlockSourceEntry` entries) remains only as the printer's source/print representation; construct it only when synthesizing blocks for printing or inference output, never to validate or lower values.
5. The standalone validator entry points (`validateExtensionBlock`, `ExtensionBlockRefResolutionContext`) are removed without replacement: `buildSymbolTable({ documents, sources, pslBlockDescriptors })` interprets registered blocks after collecting all declarations and returns `parsedBlocks`, a map holding the typed envelope of every valid block. Thread that map into interpreter calls via `PslInterpretInput.parsedBlocks` when you hold the `buildSymbolTable` result; a direct interpreter call that omits it re-derives the same envelopes internally.
