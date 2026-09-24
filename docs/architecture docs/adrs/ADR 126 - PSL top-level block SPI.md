# ADR 126 — PSL top-level block SPI

**Status:** Accepted; amended by [ADR 255 — Block specs bind top-level block values](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md). The registration SPI stands — descriptors claim keywords, pair a `discriminator` with an `entityTypes` factory, and keep the framework as the only parser — but a descriptor no longer carries a typed parameter table. The four parameter value-kinds, the descriptor-data validator, the codec-JSON value medium, and descriptor-driven printing described below are superseded: a descriptor declares its value grammar as a `spec` factory built from the shared argument combinators, validation happens by interpreting that spec after complete declaration collection, and the printer renders producer-built print documents (parsed source is never converted to text). The superseded sections are preserved as a historical record.
**Date:** 2026-06-08

---

## Decision

An extension contributes a new top-level PSL keyword by **describing the block as data**, not by shipping code. It registers an `AuthoringPslBlockDescriptor` — the keyword, whether the block is named, and a map of typed parameters — and the framework owns the single generic parser, validator, and printer that interpret any declared block.

A Postgres RLS policy, for example, is authored like any other PSL block:

```prisma
policy_select ReadPosts {
  target = Post                      // ref → a declared model
  as     = permissive                // option → one of a fixed token set
  roles  = [admin, editor]           // list of refs
  using  = "auth.uid() = author_id"  // value → a codec-typed literal
}
```

and the extension registers exactly this descriptor to make that block parseable, validatable, printable, and round-trippable:

```ts
import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';

const policySelectDescriptor: AuthoringPslBlockDescriptor = {
  kind: 'pslBlock',
  keyword: 'policy_select',
  discriminator: 'postgres-policy-select',
  name: { required: true },
  parameters: {
    target: { kind: 'ref',    refKind: 'model',                       scope: 'same-namespace', required: true },
    as:     { kind: 'option', values: ['permissive', 'restrictive'],                           required: false },
    roles:  { kind: 'list',   of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },       required: false },
    using:  { kind: 'value',  codecId: 'String',                                               required: true },
  },
};
```

No parsing or printing code runs from the extension. The descriptor is registered on `AuthoringContributions.pslBlockDescriptors`, paired with a matching `AuthoringContributions.entityTypes` factory under the same `discriminator`; the parsed block lowers to an IR class instance through that factory.

## Why describe blocks as data

PSL's grammar is closed and uniform: a top-level block is a keyword, an optional name, and a body of `x = y` assignments and double-quoted values. The framework already parses exactly this shape for the built-in keywords (`model`, `type`, `types`, `namespace`, `enum`). A contributed block has the same shape, so its structure can be *described* — keyword, parameters, parameter types — and interpreted by the same generic machinery. Nothing about a new block requires the extension to re-implement parsing.

The constraint this addresses: PSL's keyword set was closed, so an extension that wanted a new top-level construct (an RLS policy, a role, a view) had no way to add one without a core change — which conflicts with the thin-core, fat-targets principle ([ADR 005](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)). Describing blocks as data opens the keyword set to extensions while keeping all parsing in the framework.

## Parameter value-kinds

> **Superseded by [ADR 255](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md).** Descriptors carry a `spec` factory (`fixedBlock` / `entriesBlock` over the shared argument combinators) instead of a parameter-kind table; block values do not travel the codec JSON medium. This section is historical.

A parameter is one of four kinds. The split is principled, not incidental:

| Kind | What it is | Backing machinery |
|---|---|---|
| **`ref`** | an identifier that resolves to a declared entity | resolved against the `(spaceId, namespaceId, entityKind, entityName)` coordinate model; `scope` ∈ `same-namespace` / `same-space` / `cross-space` |
| **`value`** | a codec-typed value — the codec owns its representation | the existing codec/type system, same as field types and `@default` literals; opaque content (SQL predicates, JSON blobs) stays opaque to the framework |
| **`option`** | one of a fixed set of literal tokens | an inline closed token list on the descriptor — an authoring-time constraint only |
| **`list`** | a bracketed list of any of the above | combinator |

**`value` rides the codec JSON medium.** A `value` parameter names a `codecId`, exactly as a field's type and a `@default` literal's type do. The codec's `encodeJson` / `decodeJson` (with `JSON.parse` / `JSON.stringify`) carry the value through the PSL-text ↔ literal ↔ encoded-form pipeline. This gives structural parity across the three places PSL carries a typed value — field types, defaults, and block parameters — and makes any custom type usable as a parameter value with no extra work.

**`option` is not a domain enum.** `as = permissive` is configuration of the policy node, not user data; it is never realised as a stored value-set or check constraint. It is a closed list of authoring tokens that constrains what the author may write — a lightweight inline constraint, deliberately not coupled to the domain-enum machinery.

**Per-block-kind schemas, no conditional logic.** Where a parameter's validity depends on context, the answer is separate keywords with fixed parameter sets — not conditional rules inside one descriptor. Postgres RLS uses `policy_select` / `policy_insert` / `policy_update` / `policy_delete` rather than one `policy` block with an `operation` parameter. The command is encoded in the keyword, so an invalid parameter combination is structurally impossible.

## How the framework interprets a block

> **Superseded by [ADR 255](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md)** for the validate and print steps: validation interprets the descriptor's spec after complete declaration collection and publishes typed envelopes; the printer renders producer-built print documents without consulting the descriptor, and parsed source is never converted to text. Parse dispatch by keyword and lowering through the `discriminator`-matched factory stand.

**Parse.** On an unknown top-level keyword, the framework looks it up in the `pslBlockDescriptors` registry. If a descriptor claims it, the generic parser reads the block into a `PslExtensionBlock` node — a name plus a `parameters` map keyed by parameter name. No extension code runs.

**Validate.** The validator checks, at parse time and with source spans: unknown parameters; missing required parameters; an `option` value outside the declared set; a `value` the codec's `decodeJson` rejects; and a `ref` that doesn't resolve within its declared scope.

**Lower.** The `PslExtensionBlock` lowers to a Contract IR class instance via the matching `entityTypes` factory, keyed by the shared `discriminator`. Every contributed block requires a matching factory; the framework enforces this at load time (`assertPslBlocksHaveFactories`), alongside checks for duplicate keywords and malformed descriptors — each diagnostic naming the contributing extension. A `discriminator` may be shared by several keywords (e.g. `policy_select` and `policy_insert` both route to the `policy` entity kind); what must stay unique is the `keyword` itself, since that's what the parser actually dispatches on. Each block keeps its own `keyword`, distinct from its (possibly shared) `kind`, so the printer re-emits it under the keyword it was authored with rather than one borrowed from another keyword sharing its discriminator.

**Print.** The generic printer reconstructs any declared block from its descriptor and AST node, so an inferred contract round-trips back to PSL source.

Parsed blocks are stored at `PslNamespace.entries[discriminator][name]` — the same coordinate structure the IR uses ([ADR 224](ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md)). Built-in accessors (`models`, `enums`, `compositeTypes`) derive from `entries`; extension kinds are reached via `entries[discriminator]` or the `namespacePslExtensionBlocks` helper.

## Consequences

- A descriptor that correctly declares its parameters is fully parseable, validatable, printable, and round-trippable with zero extension parse/print code.
- New block shapes are additive — a new parameter entry cannot break existing blocks, and the single generic parser/validator/printer handles every declared block.
- Descriptors are inspectable data: they can be validated, documented, and reasoned about without executing extension code.
- Extensibility at the PSL layer aligns with the IR: the IR class, the lowering factory, and the PSL parse/print path are all addressed by the shared `discriminator` ([ADR 225](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)).

## Alternatives considered

**A function SPI** — each extension ships an imperative `parseFn` / `validateFn` / `emitFn` triple. Rejected: it re-implements parsing the framework already does for built-in blocks, the parser logic is opaque to inspection and analysis (you cannot reason about a block's shape without running its code), and it forces defensive machinery to contain arbitrary extension-supplied code paths. A descriptor is inspectable data and needs none of that. The closed, uniform grammar is what makes the data description sufficient — there is no block shape expressible through a function SPI that a descriptor cannot describe.

**Modelling `option` as a domain enum** — reusing the enum machinery for the fixed token set. Rejected: an `option` is authoring-time configuration, never persisted data, so coupling it to domain enums would wrongly drag in value-set storage and validation semantics it never needs.

## References

- [ADR 005 — Thin Core Fat Targets](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 104 — PSL extension namespacing & syntax](ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md)
- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- [ADR 224 — Namespace concretions address entities by coordinate](ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md)
- [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)
