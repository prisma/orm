# nullable-scalar-lists — Plan

**Spec:** `projects/nullable-scalar-lists/spec.md`
**Linear Project:** _none (operator direction: no ticket)_

## At a glance

Four slices: a shared representation foundation, then a two-deep SQL stack (storage/enforcement → typing/authoring), with a parallel Mongo slice hanging off the foundation. Mostly stacked (the SQL thread) with one parallel group (Mongo).

## Composition

### Stack (deliver in order)

1. **Slice `representation`** — Linear: _none_
   - **Outcome:** All four PSL spellings (`Foo[]`, `Foo?[]`, `Foo[]?`, `Foo?[]?`) parse into a framework `ContractField` carrying `many: false | { elementNullable: boolean }` orthogonally to the list `nullable` axis; the parser's token formatter round-trips each spelling while the semantic printer remains out of scope; contract JSON and hashes adopt the explicit nested cardinality representation. ADR 248 records the third nullability axis.
   - **Builds on:** None.
   - **Hands to:** (a) the parser/AST/symbol-table axis split (element `?` vs list `?`); (b) nested `ContractField.many.elementNullable` + its validator + canonicalization; (c) the settled ADR the downstream slices cite.
   - **Focus:** `packages/1-framework/2-authoring/psl-parser` (grammar, `type-annotation` AST, symbol-table, token formatter) and `packages/1-framework/0-foundation/contract` (`domain-types.ts`, `validate-domain.ts`, canonicalization). Deliberately NOT: the semantic PSL printer, any family storage, typing, enforcement, or the emitted `contract.d.ts` matrix (all downstream).

2. **Slice `sql-enforcement`** — Linear: _none_
   - **Outcome:** On Postgres, element nullability is domain metadata plus native-list `StorageColumn.many: { elementNullable: true }` semantic metadata. The marker directly prevents `elementNotNull` candidate generation; SQL PSL lowering adds no automatic `noCheck`. Main's rebased generated-check diff/introspection/infer lifecycle remains intact, without a schema-IR marker or direct marker drift comparison; the runtime reads and writes `NULL` array elements. Explicit `Foo[] @noCheck(elementNotNull)` retains `many: { elementNullable: false }`, the same waiver on `Foo?[]` is rejected as inapplicable, and `Foo[]` / `Foo[]?` DDL, contract, and hashes are unchanged.
   - **Builds on:** Slice `representation`'s nested `ContractField.many` descriptor + parser axis.
   - **Hands to:** distinct domain/storage semantic markers for typing plus the canonical storage waiver consumed by main's Postgres check lifecycle.
   - **Focus:** `packages/2-sql/1-core/contract` (`StorageColumn`, schema-IR column), `packages/2-sql/2-authoring/contract-psl` (`psl-field-resolution.ts`, `interpreter.ts` — storage mapping), `packages/3-targets/3-targets/postgres` (`issue-planner.ts` conditional CHECK + ALTER add/drop), the verify differ, and the scalar-list codec / Postgres driver array framing. NOT: TS typing/authoring (Slice `sql-typing`), Mongo (Slice `mongo`).

3. **Slice `sql-typing`** — Linear: _none_
   - **Outcome:** The element axis is authorable in the SQL TypeScript builder via `.many({ elementsNullable: true })`, while `.many()` and `.many({ elementsNullable: false })` remain identical. Both the emitted `contract.d.ts` and inferred `typeof contract` types match the matrix — `(Foo | null)[]`, `Foo[] | null`, `(Foo | null)[] | null`. A TS-authored SQL contract produces the same IR as the equivalent PSL-authored contract for every matrix cell.
   - **Builds on:** Slice `representation`'s framework marker and Slice `sql-enforcement`'s domain and storage semantic metadata.
   - **Hands to:** SQL TS authoring + typing at PSL parity.
   - **Focus:** `packages/2-sql/2-authoring/contract-ts` (`contract-dsl.ts` `ScalarFieldBuilder.many()` options, `authoring-type-utils.ts`, inference) and the emitted SQL domain `contract.d.ts`. NOT: storage/enforcement (Slice `sql-enforcement`), Mongo.

### Parallel group A (independent of the SQL stack; builds only on `representation`)

- **Slice `mongo`** — Linear: _none_
  - **Outcome:** MongoDB supports the element axis end-to-end: the interpreter maps the PSL axis onto the field; the derived BSON validator constrains array-item nullability (element-non-null rejects `null` items, element-nullable permits them); the Mongo TS builder authors it through a structurally coupled `many` option; inferred and emitted types match the matrix.
  - **Builds on:** Slice `representation`'s framework marker + parser axis.
  - **Hands to:** family-complete Mongo element-axis support.
  - **Focus:** `packages/2-mongo-family/2-authoring/contract-psl` (`resolveNonRelationField`, `derive-json-schema.ts`) and `packages/2-mongo-family/2-authoring/contract-ts` (`FieldBuilder.many()` options, inference). NOT: SQL.

## Dependencies (external)

- [x] None. The enforcement primitive (`CheckExpressionConstraint` / `checkExpression()` / Postgres DDL rendering) already exists on `main`; this project only wires it conditionally. No external project, library, or infra change is required.

## Sequencing rationale

- **The SQL thread is stacked (`representation` → `sql-enforcement` → `sql-typing`)** because each consumes the prior's hand-off across the same target: enforcement carries the framework marker into native-list storage semantics and separately adds a storage waiver, while typing consumes semantic metadata without inferring it from enforcement. The SQL contract / psl / adapter packages also collide if enforcement and typing run concurrently, so they serialise per the "same-adapter slices serialise" heuristic.
- **`mongo` runs parallel** to the SQL stack: it is a different family with disjoint packages and depends only on the shared framework marker from `representation` — the "different-target slices parallelise" heuristic.
- **SQL is two slices but Mongo is one** because Postgres carries the heavier machinery — the planner CHECK, the verify differ, the driver array framing, the runtime codec — which is a coherent single review on its own, separate from the typing/authoring review. Mongo has no planner-CHECK / verify-DDL / driver-framing surface (enforcement is a single validator-derivation site), so its storage, typing, and authoring cohere into one review.
- **Docs + ADR:** the ADR (the representation decision) is authored in `representation`; each slice updates the user-facing docs for the surface it ships. The project-DoD's docs/ADR item is satisfied across the slices plus close-out.
