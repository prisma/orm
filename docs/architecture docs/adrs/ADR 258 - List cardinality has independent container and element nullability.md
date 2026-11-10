# ADR 258 — List cardinality has independent container and element nullability

Status: **Accepted**

Related: [ADR 178 — Value objects in the contract](<./ADR 178 - Value objects in the contract.md>) established `many` and whole-field `nullable` as orthogonal field-shape dimensions. [ADR 244 — Check constraints are opaque wire-named expressions](<./ADR 244 - Check constraints are opaque wire-named expressions.md>) established generated `elementNotNull` checks. This ADR adds element nullability as a third field-shape dimension, which decides whether that check is derived.

## At a glance

A list has two places where `null` may occur: the list value itself and an element inside the list. PSL expresses them independently by placing `?` after the element type or after the list brackets:

| PSL | Contract shape | TypeScript |
| --- | --- | --- |
| `Foo[]` | `{ nullable: false, many: { elementNullable: false } }` | `ReadonlyArray<Foo>` |
| `Foo?[]` | `{ nullable: false, many: { elementNullable: true } }` | `ReadonlyArray<Foo \| null>` |
| `Foo[]?` | `{ nullable: true, many: { elementNullable: false } }` | `ReadonlyArray<Foo> \| null` |
| `Foo?[]?` | `{ nullable: true, many: { elementNullable: true } }` | `ReadonlyArray<Foo \| null> \| null` |

The TypeScript authoring surface couples the element option to list construction:

```ts
const fields = {
  strict: field.column(type.String()).many(),
  nullableElements: field.column(type.String()).many({ elementsNullable: true }),
  nullableList: field.column(type.String()).many().optional(),
  fullyNullable: field.column(type.String()).many({ elementsNullable: true }).optional(),
};
```

Omitting `elementsNullable`, or passing the literal `false`, preserves strict elements. The option accepts literals only: a widened `boolean` cannot produce a sound static element type and is rejected.

## Context

`nullable` describes whether the field value can be `null`. For a list field, that answers whether the entire list can be absent, but it says nothing about the values stored inside a present list. Treating one flag as both answers cannot represent all four useful combinations.

This distinction also crosses architectural layers. The domain contract needs element nullability to generate correct input and output types for every family. Native SQL array storage needs the same semantic fact so query-builder storage types and generated database checks agree. MongoDB needs it when deriving the BSON schema for array items.

## Decision

### Element nullability is an independent field-shape axis

`ContractField.many` is optional and has type `false | { elementNullable: boolean }` when present. Omission and `many: false` both mean a non-list field; a list field carries a descriptor that records whether its elements are nullable. Nesting the element property makes the invalid state “non-list field with nullable elements” unrepresentable.

In serialized model and value-object fields, omitted `many` means scalar cardinality. Deserialization normalizes it to `many: false`; canonical emission omits `many: false` again while preserving list descriptors, including nested `elementNullable: false`. This keeps scalar field JSON unchanged. Explicit malformed `many` values, including legacy `many: true` and descriptors without a boolean `elementNullable`, remain invalid, as do sibling `elementNullable` shapes.

The marker is independent of `nullable`:

- `nullable` applies to the whole field value.
- A `many` descriptor makes that value a list.
- `many.elementNullable` applies to each member of that list.

Keeping the dimensions independent makes the contract shape a direct description of the generated type rather than an inference from target-specific storage behavior.

### Native SQL array storage carries the same semantic fact

`StorageColumn.many` uses the same `false | { elementNullable: boolean }` representation for native scalar-list columns. SQL builder typing reads storage columns directly, so the domain descriptor alone is insufficient for the SQL authoring and query surfaces.

The marker does not enter `SqlColumnIR`. Schema IR describes physical columns and constraints; it does not need a second copy of a semantic fact whose physical consequence is already represented by the derived check set. Migration comparison therefore observes the generated `elementNotNull` check rather than comparing `elementNullable` directly.

Value-object lists stored as JSON do not receive a scalar-list `StorageColumn.many` descriptor; their element semantics remain in `ContractField.many` and in the JSON/BSON structure derived from the value-object type.

### Element nullability decides the element check

(Updated October 15, 2026.) PostgreSQL derives an `elementNotNull` check exactly when a native array column has `many !== false` and `many.elementNullable === false`. There is no way to keep a non-null element type and drop its check: the per-column waiver `noCheck` that allowed it is removed, because it let the declared type claim more than the database enforced.

```ts
field.column(type.String()).many({ elementsNullable: true })   // ReadonlyArray<string | null>, no element check
field.column(type.String()).many()                             // ReadonlyArray<string>, element check derived
```

Two producers describe a schema Prisma 8 did not create, and both write the nullability the database enforces. When the live database lacks the derived check, `contract infer` writes `Foo?[]`. The Prisma 7 reader reads every list in a Prisma 7 `schema.prisma` as nullable elements, because Prisma 7 creates no element check. A project that keeps its Prisma 7 schema as the contract source therefore always gets nullable element types. To get non-null elements, the project moves to a Prisma 8 source and writes `Foo[]`, and the next migration adds the check.

### Family enforcement follows the semantic marker

PostgreSQL omits the element-non-null check for nullable-element native arrays. Other generated checks remain independent. In particular, membership checks for enum arrays ignore `NULL` elements while continuing to reject non-null values outside the declared set.

MongoDB derives array-item schemas from `ContractField.many.elementNullable`. Scalar items include `null` in `bsonType`; enum items also include `null` in their allowed values; value-object items admit either the object schema or `null`. Strict-element arrays retain their existing item schemas. Container nullability is applied separately: nullable containers use `bsonType: ['null', 'array']`, while required containers remain array-only. Exclusion from `required` permits omission but does not by itself permit an explicit null.

SQLite has no scalar-list capability, so it has no storage or enforcement behavior for this axis.

### Runtime codecs preserve null at either level

A whole-list `null` bypasses list traversal. Within a present nullable-element list, each `null` element bypasses the element codec while non-null elements are encoded or decoded normally. Strictness is enforced at authoring and, where supported, by generated storage constraints rather than by making shared runtime loops reject null defensively.

Defaults follow the same rule: a nullable-element list may contain bare `null`; a strict-element list rejects it. The quoted string `"null"` remains an ordinary string value.

### PSL formatting and semantic printing are separate surfaces

The parser AST distinguishes the `?` before `[]` from the trailing `?`, and the parser's token formatter round-trips all four spellings. This decision does not require the separate semantic `PslField` printer to synthesize the new spelling; that surface remains unchanged until it has a consumer requirement of its own.

## Compatibility and historical artifacts

The nested representation intentionally replaces legacy `many: true` in domain fields and native SQL array storage. Strict lists now serialize as `many: { elementNullable: false }`; loaders reject the old boolean-list form rather than deriving a descriptor from it. Scalar-domain omission remains compatible, but existing strict-list JSON and affected contract hashes are not byte-stable. Their PostgreSQL DDL and element-non-null checks remain unchanged.

This is the operator-authorized representation decision shipped in [PR #30051](https://github.com/prisma/orm/pull/30051): cardinality and element semantics must be one nested descriptor, with no legacy-`true` acceptance path. It is a specific exception for nullable scalar lists to the [artifact-compatibility floor](../../../drive/calibration/dod.md#documentation--migration), which ordinarily requires loading a real previous-release artifact and deriving or defaulting new fields. That floor is not weakened for other changes. A test rejecting a mutated fresh artifact is not proof of historical-snapshot compatibility, and this change does not claim that compatibility.

The [application](../../../upgrade-instructions/pending/nullable-scalar-lists/app/instructions.md) and [extension](../../../upgrade-instructions/pending/nullable-scalar-lists/extension/instructions.md) upgrade instructions cover the resulting inventory and coordinated regeneration. Old list-bearing snapshots cannot be loaded unchanged by the new serializers. Re-emitting only the current contract is insufficient when tools also load historical states: each affected state needs its own source and configuration, a consistent JSON/declaration pair, and corresponding content-addressed entries, imports, start/end hashes, and dependent migration references. If historical sources or the reference mapping are unavailable, stop rather than substitute the current schema or guess hashes. Applied production history must be retained; changed identities and database markers require a separately reviewed upgrade procedure and disposable-database rehearsal, not automatic rewriting of applied snapshots or a database reset. These are upgrade obligations and limitations, not a claim that a universal historical migration has been tested.

The later Mongo container-validator correction in [PR #30568](https://github.com/prisma/orm/pull/30568) is separate from this wire migration. For contracts already using nested descriptors, consumers retain their historical snapshots and applied migrations, re-emit the current contract, and apply a **new** validator migration before writing null containers. Runtime deployment alone does not alter stored validators. The [Mongo fix upgrade instructions](../../../upgrade-instructions/pending/mongo-nullable-list-containers/app/instructions.md) distinguish this production procedure from regeneration of disposable repository fixtures.

## Consequences

### Positive

- The contract and generated TypeScript describe all four list-nullability combinations exactly.
- PSL and TypeScript authoring have equivalent expressive power.
- SQL storage typing has the semantic marker it needs.
- List cardinality and element nullability form one nested descriptor, so invalid parallel states are not representable.
- PostgreSQL and MongoDB derive their different enforcement representations from the same domain meaning.

### Costs

- Every consumer that maps `ContractField` into a list type must account for a third field-shape axis.
- SQL carries element nullability in both domain and native-array storage representations because those layers serve different type consumers.
- TypeScript authoring rejects widened boolean options; callers that choose field shape dynamically must resolve that choice before constructing the statically typed field.

## Alternatives considered

**Use whole-field `nullable` for both axes.** Rejected: one boolean cannot represent four combinations, and a nullable list is semantically different from a list containing nullable elements.

**Infer element nullability from the absence of an `elementNotNull` check.** First rejected, because a check could be explicitly waived. Adopted on October 15, 2026, when the waiver was removed: a database without the check accepts null elements, so a type that excludes them would be wrong.

**Represent nullable elements as automatic `noCheck('elementNotNull')`.** Rejected: the waiver left the declared non-null type unchanged, so it could not describe nullable elements. The waiver itself was later removed.

**Keep `elementNullable` only on `ContractField`.** Rejected for native SQL lists: SQL storage-column consumers infer element types without consulting the domain field, so removing the storage marker loses necessary type information.

**Add `elementNullable` to schema IR and compare it directly during migration diffing.** Rejected: the physical database observable is the generated check. Duplicating the semantic marker in schema IR would create two migration signals for one physical change and risk disagreement between them.
