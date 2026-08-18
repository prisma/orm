# Mongo nullable scalar-list elements

## Outcome

Mongo supports scalar-list element nullability end to end. PSL `Foo?[]` and `Foo?[]?` lower `FieldSymbol.elementOptional` to `ContractField.many.elementNullable: true`; TypeScript authoring exposes the same `.many({ elementsNullable: true })` shape as SQL; generated and inferred input/output types include `null` per element; and BSON validators permit `null` in `items` only when the marker is present.

## Design

- `.many()` and `.many({ elementsNullable: false })` preserve the existing non-null-element contract shape and types.
- `.many({ elementsNullable: true })` carries a distinct builder type-state axis and emits `many: { elementNullable: true }`; only literal `true` and `false` are accepted, while widened booleans and empty option objects are rejected.
- Whole-list `nullable` and nested `many.elementNullable` compose independently.
- Scalar and value-object arrays derive nullable `items` only from `many.elementNullable`; relation semantics are unchanged.
- Scalar-list writes wrap each non-null element with its scalar codec reference and pass `null` through unchanged. Array decoding already short-circuits `null` before invoking the element codec and is regression-tested.

## Done conditions

- [x] Mongo PSL lowering covers all four scalar-list nullability cells without changing relation lists.
- [x] Mongo TS authoring supports `.many({ elementsNullable: true | false })` with literal-only type tests.
- [x] Inferred and emitted input/output types preserve element nullability.
- [x] BSON schema derivation has exact-shape coverage for all four cells and value-object nullable elements.
- [x] Runtime encode/decode tests prove `null` elements bypass element codecs.
- [x] Affected Mongo package tests, typechecks, and lints pass.

## Out of scope

- SQL packages and behavior.
- Relation-list element nullability.
- Semantic PSL printer changes.
