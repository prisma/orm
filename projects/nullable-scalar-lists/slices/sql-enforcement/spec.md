# Slice: sql-enforcement — spec

**Project:** `projects/nullable-scalar-lists` (see [`../../spec.md`](../../spec.md), [`../../plan.md`](../../plan.md))
**Linear:** none (operator direction: no ticket)

## Chosen design

Carry element nullability from `FieldSymbol.elementOptional` into both SQL domain metadata and native-list storage semantic metadata. Generated-check derivation reads that metadata directly; explicit `noCheck` waivers remain a separate author-controlled concern.

- `ContractField.many: false | { elementNullable: boolean }` is the domain/type-system representation delivered by the `representation` slice.
- `StorageColumn`, its input/class, arktype schema, hydration/serialization, and `col()` factory use `many: false | { elementNullable: boolean }`; the nested shape makes element nullability impossible without list cardinality. `SqlColumnIR` and contract-to-schema projection remain marker-free.
- SQL PSL lowering preserves `ResolvedField.elementNullable` for domain/build metadata and writes `many: { elementNullable: true }` to native scalar-list storage without adding `noCheck`. Explicit `Foo[] @noCheck(elementNotNull)` writes only `noCheck`; `noCheck` never implies nullable element types, and the same waiver on `Foo?[]` is rejected because the check does not apply.
- Explicit waivers remain sorted canonically.
- Generated-check derivation omits the `elementNotNull` candidate when `many.elementNullable` is true, then applies the existing explicit `noCheck` filter. Migration drift does not compare `elementNullable` directly.
- Runtime scalar-list codec paths preserve `null` elements on element-nullable columns instead of passing them through the element codec.
- SQLite is irrelevant: it does not report `sql.scalarList`, and the existing capability gate rejects scalar lists.
- The semantic `@prisma-next/psl-printer` / `PslField` path is explicitly out of scope by operator decision.

## Slice Definition of Done

- [ ] SQL native-list storage carries `many: { elementNullable: true }` only for `Foo?[]` / `Foo?[]?`, with no automatic `noCheck`; explicit `Foo[] @noCheck(elementNotNull)` carries only the waiver; schema IR carries no marker; `Foo[]` / `Foo[]?` remains unchanged.
- [ ] SQL PSL interpretation maps all four list-nullability spellings to the correct domain and storage semantic shapes; explicit waivers remain independent; `Foo[]` / `Foo[]?` output is unchanged.
- [ ] Postgres generated-check derivation emits `elementNotNull` only for semantically non-null lists, then honors explicit `noCheck: ['elementNotNull']` waivers.
- [x] SQL runtime encode/decode round-trips `null` elements for element-nullable arrays while preserving existing behavior for non-null elements and whole-array `null`. `CodecRef.many` already converges SQL builder and ORM/query-builder ASTs on shared runtime loops; nullable-element semantics require no additional runtime marker because both nullable and strict arrays safely bypass null at runtime while strictness remains enforced by authoring and the database CHECK.
- [ ] Semantic PSL printer remains untouched.
- [ ] Focused package tests/typechecks/lints, `pnpm fixtures:check`, and `pnpm lint:deps` are green; workspace build/typecheck are attempted and any unrelated baseline failure is recorded.

## Pre-investigated edge cases

- A nullable whole array (`Foo[]?`) still receives the element-non-null CHECK: PostgreSQL treats a CHECK yielding `NULL` for a null array as satisfied.
- Domain and storage `many` descriptors carry element semantics only for lists; `many.elementNullable` determines whether element non-null enforcement applies, while `noCheck` is only an explicit waiver and must not be inferred from the marker.
- `Foo[]` must produce byte-identical IR and DDL to current behavior.
- Defaults containing `null` elements must be encoded without invoking the element codec for `null`, when the field is element-nullable.
- Existing check naming (`<table>_<column>_elem_not_null`) remains stable so add/drop planning and verify agree.
