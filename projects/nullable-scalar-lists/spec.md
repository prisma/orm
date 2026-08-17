# nullable-scalar-lists

## Purpose

Let authors express the full nullability matrix of a scalar list — separating _"the list itself is absent"_ from _"an element inside the list is absent"_ — so the type system and the storage constraints reflect exactly what the data may hold. Today a scalar list's elements are **always** non-null; there is no way to say an element may be `null`.

## At a glance

Scalar lists have **two orthogonal nullability axes**: the list, and its elements. PSL spells them with the position of `?` relative to `[]`:

| PSL spelling | list null? | element null? | element-non-null CHECK | Generated TS |
| --- | --- | --- | --- | --- |
| `Foo[]` | no | no | **present** | `Foo[]` |
| `Foo?[]` | no | **yes** | absent | `(Foo \| null)[]` |
| `Foo[]?` | **yes** | no | **present** | `Foo[] \| null` |
| `Foo?[]?` | **yes** | **yes** | absent | `(Foo \| null)[] \| null` |

Before this project, `Foo[]`, `Foo[]?`, and the whole-list `nullable` axis already worked (the cardinality model is described by [ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md#cardinality-many-on-value-objects-cardinality-on-relations)). Element **non-null** was already enforced: every scalar-array column received an `array_position(col, NULL) IS NULL` check.

This project adds element _nullability_ — `Foo?[]` and `Foo?[]?`. The parser represents the `?` before `[]`, the domain and native SQL storage IR carry semantic markers, and generated-check derivation emits the element-non-null check only for semantically non-null elements. An element-nullable list therefore omits the check and gains `| null` per element in generated TypeScript.

```prisma
model Post {
  id        Int       @id
  tags      String[]     // element NOT NULL — keeps the CHECK   (today)
  authors   String?[]    // element nullable — no CHECK           (new)
  reviewers String[]?    // nullable list, element NOT NULL       (today)
  editors   String?[]?   // nullable list, element nullable       (new)
}
```

**Operator-ordered restored storage representation.** `StorageColumn.elementNullable?: true` is semantic/type metadata: when `many === true`, array elements are `T | null`, and the generated `elementNotNull` check does not apply. `StorageColumn.noCheck?: CheckKind[]` remains an independent, explicitly authored enforcement waiver consumed by main's generated-check derivation, diff, introspection, and infer lifecycle. Native `Foo?[]` / `Foo?[]?` lists carry `elementNullable: true` with no automatic `noCheck`; explicit `Foo[] @noCheck(elementNotNull)` carries only the waiver and keeps non-null element types. An explicit `elementNotNull` waiver on a nullable-element list is rejected because that check is not derivable. Value-object JSONB storage carries neither storage marker nor waiver, while its domain marker is retained.

## Non-goals

- **The three shipped cases.** `Foo[]`, `Foo[]?`, and whole-list `nullable` already work — including the element-non-null CHECK for `Foo[]` — and are not redesigned. `Foo[]`'s emitted contract, hashes, and DDL must stay byte-identical.
- **The enforcement mechanism.** `CheckExpressionConstraint`, `elementNonNullCheckExpression`, and the Postgres DDL rendering already exist and work; this project makes their emission conditional, it does not touch the mechanism.
- **Non-Postgres SQL targets.** SQLite does not support scalar lists at all (`SQLite adapter does not report sql.scalarList capability`; the `PSL_SCALAR_LIST_UNSUPPORTED_TARGET` gate rejects them). There is nothing to do there — scalar lists, and therefore the element axis, are Postgres-only on the SQL side.
- **Nested lists** (`Foo[][]`), fixed-length/tuple lists — out of scope.
- **Relation-list element nullability.** Relation navigation lists (`Post[]`) are not scalar lists and gain no element axis.
- **Changing empty-list-vs-null-list semantics** — unchanged.

## Place in the larger world

The element axis threads through the same pipeline scalar lists already travel. Surfaces touched, in dependency order:

- **PSL grammar + AST** — `packages/1-framework/2-authoring/psl-parser`. `parseTypeAnnotation` currently accepts `QualifiedName (argList)? ([])? (?)?` (only a _trailing_ `?`). It must also accept a `?` _between_ the type and `[]`. `TypeAnnotationAst.isOptional()` (a single boolean) and `FieldSymbol.optional`/`.list` must split into a list axis and an element axis.
- **PSL token formatter** — `packages/1-framework/2-authoring/psl-parser/format` round-trips all four spellings. The separate semantic `@internal/psl-printer` / `PslField` surface is out of scope.
- **Framework contract IR (typing)** — `packages/1-framework/0-foundation/contract`: `ContractField` (`domain-types.ts`) gains element nullability, plus its arktype validator (`validate-domain.ts`) and canonicalization/default-omission (`canonicalization.ts`, so the flag is omitted when false and existing hashes are stable).
- **SQL contract IR (storage)** — restores `StorageColumn.elementNullable?: true` as semantic/type metadata and reuses main's existing `StorageColumn.noCheck` representation only for explicit enforcement waivers. Nullable native-list elements carry the marker without an automatic waiver. The marker is not projected into schema IR or compared for migration drift.
- **SQL interpreter** — `packages/2-sql/2-authoring/contract-psl` (`psl-field-resolution.ts`, `interpreter.ts`) maps the element axis onto both the domain field and the storage column.
- **Postgres generated-check lifecycle** — generated-check derivation reads `StorageColumn.elementNullable` and does not produce an `elementNotNull` candidate when it is true; the existing `StorageColumn.noCheck` filter remains for explicit waivers on semantically non-null lists.
- **TS authoring + type generation** — `packages/2-sql/2-authoring/contract-ts` (`ScalarFieldBuilder` in `contract-dsl.ts`) and `packages/2-mongo-family/2-authoring/contract-ts` (`FieldBuilder`). SQL authors nullable elements through `.many({ elementsNullable: true })`; Mongo will use the equivalent structurally coupled `many` option. The element axis is authorable in TypeScript at parity with PSL, and the emitted `contract.d.ts` renders the matrix cell on both the emit and `typeof contract` paths.
- **Codecs / runtime** — `CodecRef.many` (`framework-components/shared/codec-types.ts`) maps the element codec over the array; the encode/decode paths must round-trip `null` elements for element-nullable columns (the Postgres driver's array framing, and the scalar-list codec).
- **Verify / introspection** — the SQL differ must treat the element-non-null CHECK's presence/absence as the observable of element nullability: an element-nullable column has no CHECK, and adding/removing element nullability is a real add/drop-CHECK change — not spurious drift. Builds on the v0.15.0 "array columns verify cleanly" work.
- **Mongo family** — `packages/2-mongo-family/2-authoring/contract-psl` (`resolveNonRelationField`, `derive-json-schema.ts`) maps the axis and constrains array-item nullability in the BSON validator.
- **ADRs** — [ADR 178](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) defined `nullable`/`many` as the two dimensions; this project adds element nullability and must extend ADR 178 or add a new ADR (see Project-DoD).

## Cross-cutting requirements

- **The element axis is orthogonal to the list axis and explicit waivers.** `ContractField.elementNullable` and `StorageColumn.elementNullable` record typing semantics and determine whether `elementNotNull` applies. `noCheck: ['elementNotNull']` remains an explicit waiver only for a semantically non-null list. `SqlColumnIR` gains no marker, migration drift never compares `elementNullable` directly, and nullable element types are never inferred from `noCheck`.
- **Element non-null stays enforced; element-nullable omits the CHECK.** `Foo[]` / `Foo[]?` keep the `array_position(col, NULL) IS NULL` CHECK unchanged; `Foo?[]` / `Foo?[]?` emit no such CHECK. `db verify` reports the CHECK's presence/absence correctly and never as spurious drift.
- **All four spellings round-trip through the token formatter.** For each cell, PSL parses, interprets to the documented IR, emits `contract.json` + `contract.d.ts`, and the parser's token formatter reproduces the original spelling. The semantic printer is unchanged.
- **Generated TS matches the matrix exactly** — `(Foo | null)[]`, `Foo[] | null`, `(Foo | null)[] | null` — proven on both the emit path and the `typeof contract` no-emit path.
- **TS authoring reaches PSL parity.** The element axis is authorable through the SQL and Mongo field builders, and a TS-authored contract and the equivalent PSL-authored contract produce the same IR for every matrix cell.
- **Backward compatibility (hash stability).** Existing schemas emit byte-identical `contract.json`, the same `storageHash`, and the same DDL as before — the element-nullability marker is omitted when false, so `Foo[]` and `Foo[]?` are untouched and produce **no migration**.

## Transitional-shape constraints

- Every merged slice keeps CI green on `main` and leaves the four-cell matrix consistent — a slice never ships a parser that accepts `Foo?[]` without the IR able to represent it, nor an IR marker the planner/type-gen ignores.
- The element-nullability marker is captured by `storageHash`, so the Postgres planner and `db verify` always agree on whether a column's CHECK should exist — no slice may leave them out of step.
- No slice changes the emitted contract, hashes, or DDL for a schema that does not use the element axis (holds at every intermediate commit, not just at close).

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md) — not restated here).
- [x] All four PSL spellings parse, interpret in SQL and Mongo, emit, and token-format round-trip, with tests covering each cell; the semantic printer remains unchanged by explicit scope decision.
- [x] `ContractField` represents element nullability orthogonally to list nullability; SQL native-list storage lowers nullable elements to `elementNullable: true` with no automatic `noCheck`, while value-object JSONB storage carries no storage marker or waiver; existing strict-list canonicalization and storage hashes remain stable in focused tests. `pnpm fixtures:check` could not reach comparison because examples could not load the built local CLI.
- [x] Generated TS matches the matrix on both emit and `typeof contract` paths, proven by `*.test-d.ts`.
- [x] The SQL and Mongo field builders can author every matrix cell through a structurally coupled `many` option and type-state; value and type tests prove the resulting IR and literal-only option contract.
- [x] Postgres: `Foo[]` / `Foo[]?` keep the element-non-null check; `Foo?[]` / `Foo?[]?` omit it; lifecycle integration tests cover catalog state, add/drop transitions, inserts, and verification.
- [x] Postgres runtime reads and writes `NULL` array elements correctly for element-nullable columns.
- [x] Mongo BSON validators and contract-derived result shapes preserve array-item nullability per the element axis; runtime and ORM tests cover read/write null bypass.
- [x] Element-nullability semantics are documented in ADR 248, including the domain/storage marker distinction, explicit waiver semantics, TS authoring surface, and target behavior.

## Resolved decisions

All shaping questions are settled (operator-confirmed):

1. **Operator-ordered IR restoration.** `ContractField.elementNullable?: true` and `StorageColumn.elementNullable?: true` are semantic metadata meaningful only with `many`. Native nullable-element lists carry the marker and directly suppress `elementNotNull` candidate generation; they do not carry an automatic `noCheck`. Explicit `Foo[] @noCheck(elementNotNull)` has no semantic marker, and the same waiver on `Foo?[]` is rejected as inapplicable. Value-object lists remain JSONB with neither storage marker nor waiver, while retaining the domain marker.
2. **Verify signal.** Element nullability is observed via the element-non-null CHECK: introspection reads whether the `…_elem_not_null` CHECK exists on an array column; absence ⇒ element-nullable. No separate introspection probe.
3. **TS authoring.** In scope and DoD-gated. SQL builder API: `.many({ elementsNullable: true })`; omitted or false means non-null elements and emits no marker. The option is structurally coupled to list cardinality.
4. **Value-object lists.** Element nullability on value-object lists (`Address?[]`) comes along where the framework IR field and type-gen are shared, but **scalar lists are the DoD-gated target** — VO-list element nullability is not a close-out gate.

## References

- Linear Project: none (operator direction: no ticket).
- [ADR 178 — Value objects in the contract](../../docs/architecture%20docs/adrs/ADR%20178%20-%20Value%20objects%20in%20the%20contract.md) § Cardinality — defines the `nullable` (list) / `many` axes this project extends.
- [ADR 248 — List cardinality has independent container and element nullability](../../docs/architecture%20docs/adrs/ADR%20248%20-%20List%20cardinality%20has%20independent%20container%20and%20element%20nullability.md) — records the third field-shape axis and the distinction between semantic nullability and enforcement waivers.
- `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts` — `elementNonNullCheckExpression` + `buildCreateTableCallsFromNode`, the currently-unconditional CHECK this project makes conditional.
- v0.15.0 release notes — [native scalar lists](../../docs/releases/v0.15.0.md) (PR #870, #846) and the "array columns verify cleanly" fix (PR #960) this project's verify requirement extends.
- Spec-authoring context: [`drive/spec/README.md`](../../drive/spec/README.md) — **contract-impact** (satisfied by _Place in the larger world_ + _Cross-cutting requirements_), **adapter-impact** (Postgres; SQLite/Mongo called out under _Non-goals_ / _Place in the larger world_), **ADR pointer** (ADR 178 / new ADR, in Project-DoD).
