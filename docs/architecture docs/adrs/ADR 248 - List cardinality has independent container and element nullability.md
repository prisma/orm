# ADR 248 — List cardinality has independent container and element nullability

Status: **Accepted**

Related: [ADR 178 — Value objects in the contract](<./ADR 178 - Value objects in the contract.md>) established `many` and whole-field `nullable` as orthogonal field-shape dimensions. [ADR 244 — Check constraints are opaque wire-named expressions](<./ADR 244 - Check constraints are opaque wire-named expressions.md>) established generated `elementNotNull` checks and explicit per-column `noCheck` waivers. This ADR adds element nullability as a third field-shape dimension and keeps it distinct from enforcement waivers.

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
  strict: field.text().many(),
  nullableElements: field.text().many({ elementsNullable: true }),
  nullableList: field.text().many().nullable(),
  fullyNullable: field.text().many({ elementsNullable: true }).nullable(),
};
```

Omitting `elementsNullable`, or passing the literal `false`, preserves strict elements. The option accepts literals only: a widened `boolean` cannot produce a sound static element type and is rejected.

## Context

`nullable` describes whether the field value can be `null`. For a list field, that answers whether the entire list can be absent, but it says nothing about the values stored inside a present list. Treating one flag as both answers cannot represent all four useful combinations.

This distinction also crosses architectural layers. The domain contract needs element nullability to generate correct input and output types for every family. Native SQL array storage needs the same semantic fact so query-builder storage types and generated database checks agree. MongoDB needs it when deriving the BSON schema for array items. An enforcement waiver cannot substitute for this semantic information because waiving a check does not change what the contract declares or what TypeScript accepts.

## Decision

### Element nullability is an independent field-shape axis

`ContractField.many` is `false | { elementNullable: boolean }`. A non-list field carries `many: false`; a list field carries a descriptor that records whether its elements are nullable. Nesting the element property makes the invalid state “non-list field with nullable elements” unrepresentable. Validation rejects the legacy `many: true` and sibling `elementNullable` shapes.

The marker is independent of `nullable`:

- `nullable` applies to the whole field value.
- A `many` descriptor makes that value a list.
- `many.elementNullable` applies to each member of that list.

Keeping the dimensions independent makes the contract shape a direct description of the generated type rather than an inference from target-specific storage behavior.

### Native SQL array storage carries the same semantic fact

`StorageColumn.many` uses the same `false | { elementNullable: boolean }` representation for native scalar-list columns. SQL builder typing reads storage columns directly, so the domain descriptor alone is insufficient for the SQL authoring and query surfaces.

The marker does not enter `SqlColumnIR`. Schema IR describes physical columns and constraints; it does not need a second copy of a semantic fact whose physical consequence is already represented by the derived check set. Migration comparison therefore observes the generated `elementNotNull` check rather than comparing `elementNullable` directly.

Value-object lists stored as JSON do not receive a scalar-list `StorageColumn.many` descriptor; their element semantics remain in `ContractField.many` and in the JSON/BSON structure derived from the value-object type.

### Semantic nullability and enforcement waivers remain distinct

PostgreSQL derives an `elementNotNull` check only when a native array column has `many !== false` and `many.elementNullable === false`. The ordinary explicit-waiver filter runs after candidate derivation.

These two declarations therefore mean different things:

```ts
field.text().many({ elementsNullable: true })
field.text().many().noCheck('elementNotNull')
```

The first declares `ReadonlyArray<string | null>` and produces no element-non-null check because that check does not apply. The second still declares `ReadonlyArray<string>` but explicitly declines database enforcement of the declared invariant. It carries `noCheck: ['elementNotNull']` while retaining `many: { elementNullable: false }`.

No automatic `noCheck` is added for nullable elements, and type generation never infers nullable elements from `noCheck`. An explicit `elementNotNull` waiver on an element-nullable list is rejected because there is no applicable generated check to waive.

### Family enforcement follows the semantic marker

PostgreSQL omits the element-non-null check for nullable-element native arrays. Other generated checks remain independent. In particular, membership checks for enum arrays ignore `NULL` elements while continuing to reject non-null values outside the declared set.

MongoDB derives array-item schemas from `ContractField.many.elementNullable`. Scalar items include `null` in `bsonType`; enum items also include `null` in their allowed values; value-object items admit either the object schema or `null`. Strict-element arrays retain their existing item schemas.

SQLite has no scalar-list capability, so it has no storage or enforcement behavior for this axis.

### Runtime codecs preserve null at either level

A whole-list `null` bypasses list traversal. Within a present nullable-element list, each `null` element bypasses the element codec while non-null elements are encoded or decoded normally. Strictness is enforced at authoring and, where supported, by generated storage constraints rather than by making shared runtime loops reject null defensively.

Defaults follow the same rule: a nullable-element list may contain bare `null`; a strict-element list rejects it. The quoted string `"null"` remains an ordinary string value.

### PSL formatting and semantic printing are separate surfaces

The parser AST distinguishes the `?` before `[]` from the trailing `?`, and the parser's token formatter round-trips all four spellings. This decision does not require the separate semantic `PslField` printer to synthesize the new spelling; that surface remains unchanged until it has a consumer requirement of its own.

## Consequences

### Positive

- The contract and generated TypeScript describe all four list-nullability combinations exactly.
- PSL and TypeScript authoring have equivalent expressive power.
- SQL storage typing has the semantic marker it needs without misusing an enforcement waiver.
- List cardinality and element nullability form one nested descriptor, so invalid parallel states are not representable.
- PostgreSQL and MongoDB derive their different enforcement representations from the same domain meaning.

### Costs

- Every consumer that maps `ContractField` into a list type must account for a third field-shape axis.
- SQL carries element nullability in both domain and native-array storage representations because those layers serve different type consumers.
- TypeScript authoring rejects widened boolean options; callers that choose field shape dynamically must resolve that choice before constructing the statically typed field.

## Alternatives considered

**Use whole-field `nullable` for both axes.** Rejected: one boolean cannot represent four combinations, and a nullable list is semantically different from a list containing nullable elements.

**Infer element nullability from the absence of an `elementNotNull` check.** Rejected: a check may be explicitly waived or absent from an external database. Enforcement state is not a reliable type declaration.

**Represent nullable elements as automatic `noCheck('elementNotNull')`.** Rejected: `noCheck` is an author-controlled enforcement waiver that deliberately leaves the declared non-null type unchanged. Reusing it for semantic nullability would make SQL builder types ambiguous and collapse two different author intents.

**Keep `elementNullable` only on `ContractField`.** Rejected for native SQL lists: SQL storage-column consumers infer element types without consulting the domain field, so removing the storage marker loses necessary type information.

**Add `elementNullable` to schema IR and compare it directly during migration diffing.** Rejected: the physical database observable is the generated check. Duplicating the semantic marker in schema IR would create two migration signals for one physical change and risk disagreement between them.
