# ADR 206 — Operations as TypeScript functions

## Context

Operations contributed by targets, adapters and extensions — `ilike`, `cosineDistance`, and any future operator — are described to the framework by a declarative record: an argument list in which each argument targets a codec by identity or by trait, a return codec, and a lowering spec. The framework reads that record, derives call signatures for the SQL builder's `fns` surface and the ORM column helper, and wraps user-supplied values as parameter references using the codec identity on each argument position.

The shape of that record is a closed structure. It can say "this argument accepts any expression of codec X" or "of any codec with traits T", and nothing else. It cannot express a generic tying two argument codecs together, a non-database TypeScript type such as a numeric dimension or an option bag, a conditional return codec that depends on the argument codec, or a method overload. Every operation is forced into the single shape that the records can describe. Extensions that want more do not have a way to ask for it.

Authoring an operation also duplicates information. The runtime descriptor carries the shape the dispatch layer needs; the contract's operation-types entry carries the same shape again so the type-level surface can see it. Keeping the two in step is manual. Drift between them is an ordinary authoring mistake rather than something the compiler can prevent.

## Decision

Operations are authored as TypeScript functions. The function's signature is the type-level surface. The function's body is the runtime — it receives user arguments (values or expressions), wraps them into parameter references with the appropriate codec via the `toExpr(value, codecId?)` helper, and returns an AST expression node produced by `buildOperation({ method, self, args, returns, lowering })`. Each parameter type is written either as `CodecExpression<CodecId, Nullable, CT>` when the argument is bound to an exact codec, or as `TraitExpression<Traits, Nullable, CT>` when the argument is gated by capability traits; both union an `Expression` of the matching shape, a raw JS value from the codec-types map, and `null` when `Nullable` is true. Alongside the function each operation carries an `SqlOperationDescriptor` with three fields: `method`, an optional `self` dispatch hint naming either the codec identity or the trait set its first argument targets, and the `impl` function. The return codec, the lowering template, and the codecs of subsequent arguments live inside the AST node the function constructs, not on the descriptor.

Because both `CodecExpression` and `TraitExpression` take the contract's codec-types map as a type parameter, each target, adapter and extension exposes its operation contributions behind a factory generic over that map — `QueryOperationTypes<CT>` at the type level and a matching `<package>QueryOperations<CT>()` function at the runtime level. The contract-assembly layer calls the factory once with the contract's concrete codec-types map. Every signature that reaches the SQL builder or the ORM client is already concrete; there is no lane-level projection step that rewrites authored types into contract-bound types.

## Design principles

1. **The function is the signature.** Type-level and runtime authoring are a single surface. Drift between a declarative record and a matching runtime function is not possible because there is no declarative record.
2. **Dispatch metadata is the minimum.** `SqlOperationDescriptor` carries `method`, an optional `self` hint, and the `impl` function. The return codec, the lowering spec, and the argument wrapping all live inside the function's body or on the AST node the function builds.
3. **`self` is the single source of truth for column-helper reachability.** The same hint is read by the ORM at runtime to index operations by codec and by the type system to decide which operations appear on a field. Because the two planes consume the same value, they cannot disagree.
4. **Argument wrapping belongs to the operation.** The dispatch layer does not know the codec of any argument and does not need to. An operation whose second argument is an exact textual codec calls `toExpr(arg, 'pg/text@1')` to wrap it; an operation whose argument is a raw numeric dimension is responsible for embedding it as a literal in the AST node.
5. **The codec-types map is bound at factory-call time.** Each target, adapter and extension exposes its operations behind a `QueryOperationTypes<CT>` factory generic over the contract's codec-types map. The contract-assembly layer instantiates the factory with the contract's concrete map. Authored signatures reach the SQL builder and ORM client already specialised to that contract; no mapped-type signature projection at the lane boundary is needed.

## How matching works

The SQL builder's `fns` surface exposes every registered operation as a property. Accessing `fns.someOp` returns the `impl` the operation was authored with, already bound against the contract's codec-types map at the moment the query context was constructed. Because no type-level transformation happens between authoring and call, any generics or conditional returns the author wrote survive to the call site unchanged, and call-site inference behaves the same way it does for any plain TypeScript function.

The ORM column helper exposes operations through a different path. At `ModelAccessor` construction time the runtime walks every registered descriptor's `self` hint. When the hint names a codec identity, the operation is indexed under that codec directly. When the hint names a trait set, the runtime walks the codec registry and indexes the operation under every codec whose trait set contains the required traits. Field access performs a single lookup keyed on the field's codec identity; both forms of `self` collapse to the same index.

The type-level counterpart of this indexing is a structural read of the same `self` field from the type describing the operation. For each registered operation, the type system asks whether the field's codec identity equals `self.codecId`, or whether the field's codec traits contain `self.traits`. The logic is identical to the runtime walk, driven by the same field, and cannot drift. When matching succeeds, the method exposed on the column drops the `impl`'s first parameter — the column is bound as the self argument when the method is accessed — and preserves everything else, including authored generics.

## Predicate detection

The distinction between predicate operations (return a boolean, composable inside `and`/`or`/`not`) and non-predicate operations (return a value, offer comparison methods on the result) does not depend on anything the descriptor carries in this model. When the runtime invokes the operation's `impl`, it receives an AST expression node whose return codec is already attached (via the `returns` field on the `OperationExpr` node built by `buildOperation`). Reading the `'boolean'` trait off that return codec decides the shape the ORM column helper returns on the caller's behalf. No separate return field on the descriptor is needed.

## Interaction with other subsystems

- **Operation arguments.** [ADR 203](ADR%20203%20-%20Trait-targeted%20operation%20arguments.md) introduced codec-identity and trait-set targeting for argument specs. The primitive survives — the self hint uses the same vocabulary — but it now applies only to the ORM column-helper dispatch. The SQL builder no longer reads argument specs; it calls the authored function directly.
- **Adapter SPI.** [ADR 016](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) described how adapters contribute lowering. The adapter runtime descriptor's `queryOperations` slot now yields a factory rather than a const array. The contract-assembly layer calls the factory with the contract's codec-types map. The amendment below then moved a target's built-in operations off the adapter and onto the target descriptor's identical slot.
- **Codec registry.** [ADR 030](ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) defines codec metadata including traits. The ORM column helper continues to read traits from the registry to expand trait-targeted self hints. Codec-types flow from the same registry into the contract and onward into each operation factory.
- **Extension compatibility.** [ADR 017](ADR%20017%20-%20Extension%20Compatibility%20Policy.md) is honoured: old declarative operation records are not retained, so the decision is a breaking change for extensions that ship their own operation contributions. The breakage is local — each extension rewrites its operation contribution at the factory boundary, without changes elsewhere in the authoring surface.

## Non-goals

- **Changing the built-in comparison methods.** Equality, ordering, `like`, `isNull`, and their siblings continue to live in the comparison-methods metadata. They are gated by codec traits, not by this operation registry.
- **Deriving self hints from the function's first parameter.** The type system could in principle pattern-match the author's first parameter to recover the codec or trait set it accepts. Having the author state the hint explicitly keeps the dispatch key obvious to a reader and keeps the type-level matcher identical to the runtime walk.

## Consequences

### Positive

- Authors can use TypeScript's full expressiveness on operation signatures: generics, conditional types, overloads, and non-database argument types. Anything the language can type, the author can write.
- The registry shrinks. The framework no longer validates argument-spec forms across every operation at registration time; it validates only the single self hint.
- The type-level surface derives from the same function value that the runtime invokes. There is no way for the two to describe different argument shapes.
- Predicate detection becomes a property of the operation's output, which means authors cannot forget to mark an operation as a predicate — the AST node answers.

### Trade-offs

- Authors write the argument-wrapping helpers that the framework used to write for them. This is a few lines per operation. A small helper covers the common case.
- Operation contributions ship as factories instead of const arrays. The adapter-assembly pipeline instantiates each factory with the contract's codec-types map. This adds one call at wiring time and one generic parameter at the authoring boundary.
- Pre-existing extensions that registered operations declaratively must be rewritten. The new surface is not shape-compatible with the old one.

## Alternatives considered

### Enrich the declarative spec

Extend the current record with more fields — dimension parameters, conditional returns, overload lists — to cover the cases the closed shape cannot. Rejected. Each addition enlarges the framework's vocabulary and the validator alongside it. The richness the authors want is TypeScript itself; reinventing a subset of it in an ad-hoc record is worse than letting authors use the language directly.

### Keep the declarative surface and add an optional signature override

Let authors continue to write the declarative record in most cases, and attach an optional function-typed signature for operations that need more. Rejected. Two authoring surfaces mean two places where an operation can drift out of step with itself, and the richer surface swallows the simpler one over time anyway. Collapsing to a single surface is the point.

### Global declaration-merged codec registry

Have `CodecExpression` and `TraitExpression` read the JS-value type from a globally augmented interface, so authors can write signatures without the `CT` type parameter. Rejected. The augmentation collapses a TypeScript project to a single contract. A library that works with two contracts in one program — for example a migration tool inspecting source and target — would see the registries overlap.

## Amendment: a target's built-in operations are contributed by its target pack

A target's own query vocabulary lives in the target pack, not the adapter. [ADR 005](ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) puts dialect vocabulary in the target; [ADR 016](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) leaves the adapter responsible for rendering an AST and binding its parameters. Deciding that Postgres spells case-insensitive matching `ILIKE`, or that full-text search goes through `to_tsvector` and a `tsquery`, is the first kind of decision and not the second.

So `@internal/target-postgres` contributes `ilike` — which moved there — along with `fullTextMatches`, `fullTextRank`, `fullTextHeadline` and the four `tsquery` parsers, and `@internal/adapter-postgres` contributes no query operations at all; its `operation-types` export is gone rather than kept as a shim. Nothing in the framework had to change: `SqlStaticContributions.queryOperations` was already optional on every SQL component, `createSqlExecutionStack` already iterates the target, and `extractQueryOperationTypeImports` already reads `types.queryOperationTypes` from every descriptor. An adapter may still contribute a genuinely adapter-specific operation; Postgres simply has none. Extensions are unaffected.

Emitted Postgres `contract.d.ts` files follow, importing `QueryOperationTypes` from `@internal/target-postgres/operation-types` under the alias `PgTargetQueryOps`. `contract.json` does not change and no contract hash moves; an application re-emits its types and keeps working.

The full-text operations take the query as a `pg/tsquery@1` argument and an options object whose members — the text-search configuration of the searched column, `ts_rank`'s normalization bitmask, `ts_headline`'s markers and word counts — Postgres will not accept as parameters and which therefore reach the SQL as literals. Each is validated before a statement exists, against an allowlist for the configuration and a range or character rule for the rest, and anything else throws `RUNTIME.ARGUMENT_INVALID`. The operations do not parse the query. It comes from one of four target helpers named after the Postgres parsers (`websearchToTsquery`, `toTsquery`, `plaintoTsquery`, `phrasetoTsquery`), or from the `tsquery` template tag, which quotes each interpolated value as one term and parses the result with `to_tsquery`. A `tsquery` value read back from a query is also accepted and binds as a `tsquery` parameter. The codec's application value is a branded string that only a query result produces, so a bare string is a type error rather than a query that silently matches nothing.

The parsers set two patterns. First, an operation registered without `self` attaches to no ORM column and is reachable only as a SQL-builder `fns` member. Second, the registered `impl` is also exported as a plain function from the target's `full-text` subpath, which is how ORM code reaches it. That function is not generic over `CT`: its text argument accepts the target's own `textual` codecs, which the target fixes, so it needs no contract. Note that `buildOperation` still makes the parser's first argument the `self` of its AST node; there `self` means the first operand, not the column the operation attaches to. The `tsquery` tag is only an export; it is not registered as an operation.

Anchors: [`query-operations.ts`](../../../packages/3-targets/3-targets/postgres/src/core/query-operations.ts) and [`full-text-options.ts`](../../../packages/3-targets/3-targets/postgres/src/core/full-text-options.ts) for the operations and their option checks; [`full-text-parsers.ts`](../../../packages/3-targets/3-targets/postgres/src/core/full-text-parsers.ts) and [`tsquery-tag.ts`](../../../packages/3-targets/3-targets/postgres/src/core/tsquery-tag.ts) for the ways to build a query; [`descriptor-meta.ts`](../../../packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts) for the import spec the emitter writes.

## Open questions

- Where exactly the factory boundary sits in the contributor SPI. Target, adapter and extension runtime descriptors expose a `queryOperations` slot whose shape is `() => SqlOperationDescriptors`; today each contributor's thunk (the Postgres target's included) calls its `QueryOperations<CT>()` factory internally with an unconstrained `CT`, and the runtime's `createSqlExecutionStack` calls the slot with no type argument, so the binding described under Decision is nominal at runtime and concrete only in the emitted `contract.d.ts`, where the emitter instantiates each `QueryOperationTypes` alias with the contract's `CodecTypes`. Threading the contract's concrete codec-types map through the runtime slot remains an open design question.

## Decision record

Operations are authored as TypeScript functions whose parameters use `CodecExpression<CodecId, Nullable, CT>` or `TraitExpression<Traits, Nullable, CT>`, accompanied by an `SqlOperationDescriptor` whose `self` field names the codec or trait the first argument targets. Targets, adapters and extensions expose operation contributions behind a `QueryOperationTypes<CT>` factory which the contract-assembly layer instantiates once. The SQL builder surface flows each authored `impl` through unchanged; the ORM column helper reads the `self` hint to decide reachability. The framework validates only the `self` hint and dispatches by `method`; the runtime costs of argument wrapping (via `toExpr`), return-codec attachment, and lowering are paid by the authored function itself (via `buildOperation`).
