# Design — Destructive changes need stated intent

This is the implementation specification. Every rule is numbered so a slice spec, a dispatch brief or a reviewer can cite it. Where a rule names a file, function or type, the name was verified against the worktree at commit `2c47b4fae1` or against branch `pr-30331` (prisma/orm#30331) on 2026-10-01, then checked by an independent review of the first draft. An implementer who finds the code has moved follows the rule, not the path, and records the new path in the slice spec.

The reasoning behind the rules is in [`design-notes.md`](./design-notes.md). The scope and the definition of done are in [`spec.md`](./spec.md). Section 12 maps the rules to slices. Section 15 lists the only points a slice spec may still decide.

Terms used throughout:

- **Origin schema**: the schema IR the planner diffs against. For `migration plan` it is derived from the origin contract snapshot by `contractToSchema`. For `db update` and `db init` it is the introspected database.
- **Destination contract**: the `Contract` object the planner receives as `contract`. For `migration plan` without `--to`, and for `db update` and `db init` without `--to`, it is the emitted `contract.json` after `familyInstance.deserializeContract`.
- **Storage name**: a table name as it appears in `contract.storage.namespaces[ns].entries.table`, or a column name as it appears in that table's `columns`.
- **Hint**: one entry in the contract's `hints` section (section 3).
- **Spent hint**: a hint whose old name is absent from the origin schema.
- **Tombstone**: a model or field carrying `deleted: true`.
- **Message texts**: every message below is final. `<...>` marks a substitution; everything else is literal. Where a message exists in a model form and a field form, the field form replaces `@@hint` with `@hint`, `Model "<M>"` with `Field "<M>.<f>"`, `model` with `field`, and `table` with `column`, and nothing else.

## 1. PSL syntax

### 1.1 Attribute

- **R1.1** The SQL family registers a model attribute named `hint` and a field attribute named `hint` in `sqlAttributeSpecs` (`packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`), as `hint: () => hintModelSpec` under `model` and `hint: () => hintFieldSpec` under `field`. The model spec is registered in slice 1, the field spec in slice 2.
- **R1.2** Both specs are built with the declarative kit ([ADR 231](../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md)) with no positional parameters. Named parameters, in this order:

  | Name | Type | Added in | Documentation string |
  | --- | --- | --- | --- |
  | `was` | `optional(str())` | slice 1 (model), slice 2 (field) | model: `The storage name this table had before it was renamed, as @@map would have spelled it.` field: `The storage name this column had before it was renamed, as @map would have spelled it.` |
  | `deprecated` | `optional(bool())` | slice 1 (model), slice 2 (field) | `Reserved. Not yet supported.` |
  | `deleted` | `optional(bool())` | slice 4 | model: `Marks this model as removed. The planner drops its table where the table still exists, and the model contributes nothing else to the contract.` field: `Marks this field as removed. The planner drops its column where the column still exists, and the field contributes nothing else to the contract.` |

  Before slice 4, `deleted` is not a parameter, so the kit rejects it with its own `received unknown argument "deleted"` message. That is the intended behaviour for those releases.
- **R1.3** Spec documentation strings: model `Tells the migration planner the intent behind a change to this model's table that a diff cannot infer.`; field `Tells the migration planner the intent behind a change to this field's column that a diff cannot infer.`
- **R1.4** The parser needs no change. `@@hint(was: "Profile")` parses today as a named argument with a string literal, `@@hint(deleted: true)` as a boolean literal. The kit's own `PSL_INVALID_ATTRIBUTE_SYNTAX` messages cover an unknown argument, a duplicate argument, a missing value, `was: Profile` (`Expected a string literal`) and `deleted: "yes"` (`Expected a boolean literal`).

### 1.2 Diagnostic code

- **R1.5** `export const PSL_HINT_INVALID: ContributedPslDiagnosticCode = 'PSL_HINT_INVALID'` is declared in `sql-attribute-specs.ts` next to the other contributed codes, and documented in `packages/2-sql/2-authoring/contract-psl/README.md` beside the other `PSL_*` codes. Every semantic hint diagnostic below uses it, through `leafDiagnostic(ctx, node, message, PSL_HINT_INVALID)` in a spec `refine`, or through the interpreter's diagnostic collector with the same code, anchored on the node named by the rule.

### 1.3 Refinement rules (in the spec's `refine`, anchored on the attribute)

- **R1.6** At least one argument is present: `@@hint needs one of was, deleted or deprecated.`
- **R1.7** `was` and `deleted` are not both present: `@@hint cannot combine was and deleted: a renamed table still exists, a deleted one does not.`
- **R1.8** `was` is not empty: `@@hint(was:) must name the previous storage name.`
- **R1.9** `deleted: false` is rejected: `@@hint(deleted: false) says nothing; remove the hint.`
- **R1.10** `deprecated` is rejected whatever its value: `@@hint(deprecated:) is reserved and not yet supported. Remove the model from the schema and run db update, or mark it deleted once no application version reads it.` This is the whole of the reserved-vocabulary requirement.

### 1.4 Placement and uniqueness (in the interpreter)

A new module `packages/2-sql/2-authoring/contract-psl/src/psl-hint-resolution.ts` exports `collectHints(input): { hints: HintEntry[]; tombstoneModels: ReadonlySet<ModelSymbol>; tombstoneFields: ReadonlySet<FieldSymbol>; diagnostics: PslDiagnostic[] }`. `interpretPslDocumentToSqlContract` (`interpreter.ts`) calls it immediately after it has built `physicalNames` (the `@@map` / `@map` resolution, lines 2151 to 2184 today) and before `buildModelNodeFromPsl` runs, so every later stage can skip tombstones. Each rule below is one diagnostic.

- **R1.11** A model declares `@@hint` at most once. The duplicate is reported with the existing `duplicateModelAttributeDiagnostic` (`interpreter.ts:375`, code `PSL_DUPLICATE_ATTRIBUTE`, message `` `@@hint` declared more than once on model "<M>". ``). Fields use a new field form of the helper (none exists today) with message `` `@hint` declared more than once on field "<M>.<f>". ``
- **R1.12** `@@hint` is accepted on `model` blocks only. The Prisma 8 SQL grammar has no `view` block; `type` blocks already reject every `@@` attribute.
- **R1.13** `@hint` is accepted on every field that is not model-typed (scalar fields, scalar list fields and value-object fields); each such field lowers to exactly one column. On a model-typed field (owning-side relation field, model-typed list, or back-relation) it is rejected on the attribute: `@hint belongs on the scalar foreign-key field, not on the relation field "<M>.<f>".` The back-relation rule in `psl-relation-resolution.ts` already rejects every attribute but `@relation`; the interpreter adds the message above for owning-side relation fields and model-typed lists, which `collectResolvedFields` otherwise skips silently.
- **R1.14** Inheritance. A model with `@@base` and no `@@map` is a single-table-inheritance child and shares its base's table; a model with `@@base` and `@@map` is a multi-table-inheritance variant with its own table.
  - `@@hint(was:)` on a single-table child: `@@hint(was:) belongs on the model that owns the table, "<Base>".`
  - `@@hint(was:)` on a multi-table variant: accepted; it names the variant's own table.
  - `@@hint(deleted: true)` on any model carrying `@@base` or `@@discriminator`: `@@hint(deleted: true) is not supported inside an inheritance hierarchy; remove model "<M>" from the hierarchy first.`
- **R1.15** `was` differs from the model's own storage name: `@@hint(was: "<was>") names the table's current name; the hint is spent, remove it.`
- **R1.16** Within one namespace, `was` equals no storage name declared by another model or tombstone of the same contract: `@@hint(was: "<was>") on model <M> names a table this contract also declares through model <Other>; a rename cannot apply while both exist.`
- **R1.17** Within one namespace, two models do not share a `was`: `Models <A> and <B> both claim to have been "<was>".`
- **R1.18** Field `was`, scoped to the storage table. `collectHints` maps a model carrying `@@base` and no `@@map` to its base's `physicalNames` entry (following `@@base` transitively), so single-table-inheritance siblings sharing a table are checked together: differs from the field's own column name (`@hint(was: "<was>") names the column's current name; the hint is spent, remove it.`); equals no other column declared on the same table (`@hint(was: "<was>") on field <M>.<f> names a column this contract also declares through field <Other>.<g>; a rename cannot apply while both exist.`); and two fields on one table do not share a `was` (`Fields <A>.<f> and <B>.<g> both claim to have been "<was>".`).
- **R1.19** `was` is matched verbatim as a bare storage name inside the model's own namespace. It is never parsed. A value containing `.` is a table name containing a dot.

### 1.5 Tombstones

- **R1.20** A table tombstone contributes exactly: one hint entry `{ deleted: true, control? }` keyed by the model's storage name (its `@@map` value, else the model name verbatim) in the model's namespace. `control` is the model's `@@control` value when present (R7.5). The model is absent from `domain`, `storage`, the derived roots, the generated `contract.d.ts`, and every registry the interpreter builds from models (inheritance, polymorphism, relation resolution, ownership, control policy).
- **R1.21** Inside a table tombstone the interpreter reads `@@hint`, `@@map` and `@@control` and ignores every other model attribute and every field together with its attributes, without a diagnostic. The block may be empty.
- **R1.22** A column tombstone contributes exactly: one hint entry `{ deleted: true }` keyed by its column name (its `@map` value, else the field name) under its model's table. The field is absent from its model in `domain`, from its table's `columns`, and from the generated types.
- **R1.23** Inside a column tombstone's attributes the interpreter reads `@hint` and `@map` and ignores the rest without a diagnostic. A column tombstone inside a table tombstone is ignored by R1.21.
- **R1.24** Any reference that resolves to a tombstone is a diagnostic anchored on the referencing node, with one message shape: `<Referrer> refers to <target>, which is marked @@hint(deleted: true).` where `<Referrer>` is one of `Relation "<M>.<f>"`, `Policy "<name>"` (Postgres `policy_*` block `target`), `@@discriminator on model <M>`, `@@base on model <M>`, `@@id on model <M>`, `@@unique on model <M>`, `@@index on model <M>`, `@relation(fields:) on "<M>.<f>"`, `@relation(references:) on "<M>.<f>"`, or `Attribute @@<name> on model <M>` for any contributed attribute whose `fieldRef` / `entityRef` resolves to a tombstone; and `<target>` is `model <T>` or `field "<T>.<g>"`. A `@id` on a column tombstone: `Field "<M>.<f>" is marked @hint(deleted: true) and cannot be the id.`

### 1.6 Composition

- **R1.25** A model may carry `@@hint(was:)` and have fields carrying `@hint(was:)` or `@hint(deleted: true)` in the same contract. They are independent entries that compose at plan time (R5.9).

## 2. TypeScript authoring

Package: `packages/2-sql/2-authoring/contract-ts`.

- **R2.1** `SqlStageSpec` (`contract-dsl.ts`) gains `readonly hint?: TableHint`:

  ```ts
  export type TableHint = { readonly was: string; readonly deleted?: never } | { readonly deleted: true; readonly was?: never };
  ```

  Slice 1 adds the type with the `was` arm only; slice 4 adds the `deleted` arm. Authored as `model('User', { fields }).sql({ table: 'User', hint: { was: 'Profile' } })` and `model('Legacy', { fields: {} }).sql({ hint: { deleted: true } })`.
- **R2.2** `ScalarFieldBuilder` gains `hint<const H extends ColumnHint>(hint: H): ScalarFieldBuilder<ScalarFieldState<..., Hint: H>>`, where `ColumnHint` has the same two arms as `TableHint` (slice 2 adds `was`, slice 4 adds `deleted`). `ScalarFieldState` gains a generic parameter `Hint extends ColumnHint | undefined = undefined` and the field `readonly hint?: Hint`, threaded through every re-instantiation in the builder's methods (`optional`, `column`, `many`, `noCheck`, `default`, `defaultSql`, `id`, `unique`, `sql`), through every positional `infer` over `ScalarFieldState` in `contract-dsl.ts` (31 sites today) and the one in `authoring-type-utils.ts:50`. The `const` generic is what lets the type level see `{ deleted: true }` (R2.8).
- **R2.3** There is no `deprecated` arm. A user who writes `{ deprecated: true }` gets a TypeScript excess-property error; that is the reservation.
- **R2.4** Storage names on this surface: a table tombstone's key is `sqlSpec.table ?? applyNaming(modelName, definition.naming?.tables)`; a column tombstone's key and a field `was` comparison use `fieldState.columnName ?? applyNaming(fieldName, definition.naming?.columns)` (`contract-lowering.ts`, `collectRuntimeModelSpecs`). R1.15 to R1.18 apply to these resolved names.
- **R2.5** Lowering enforces R1.11 (two `.hint()` calls: the second call throws), R1.13 (the method exists only on `ScalarFieldBuilder`, so relation builders cannot carry it), R1.14 to R1.18 and R1.24, throwing `contractError('CONTRACT.HINT_INVALID', message, { meta: { model, field?, was? } })`. `HINT_INVALID` is added to the `ContractSubcode` union in `contract-ts/src/contract-errors.ts`, which forms `CONTRACT.HINT_INVALID`. The message text is the PSL text of the same rule, byte for byte, with the DSL's model and field names substituted.
- **R2.6** A model whose `sql()` stage carries `hint: { deleted: true }` is a table tombstone: `collectRuntimeModelSpecs` emits one `HintEntry` and no `RuntimeModelSpec`; its fields and relations are not lowered. A field whose state carries `hint: { deleted: true }` is a column tombstone: no `FieldNode`, one `HintEntry`.
- **R2.7** Both surfaces converge on `ContractDefinition` (`contract-definition.ts`), which gains `readonly hints: readonly HintEntry[]`:

  ```ts
  export type HintEntry =
    | { readonly namespaceId: string | undefined; readonly table: string; readonly column?: undefined; readonly hint: TableHint; readonly control?: ControlPolicy }
    | { readonly namespaceId: string | undefined; readonly table: string; readonly column: string; readonly hint: ColumnHint };
  ```

  `namespaceId` resolves like `ModelNode.namespaceId` (`undefined` is the target's default namespace). `buildSqlContractFromDefinition` (`build-contract.ts`) groups the entries into the section of section 3, creating a `tables` or `columns` container only when it has at least one entry. A definition with no entries produces a contract with no `hints` key.
- **R2.8** Type-level derivation (`contract-ts/src/contract-types.ts`, the `SqlContractResult` mapped types): a model whose `SqlSpec['hint']` extends `{ deleted: true }` is omitted from the inferred domain and storage types, and a field whose state `Hint` extends `{ deleted: true }` is omitted from its model's inferred fields. A `.test-d.ts` asserts both omissions and that `{ deprecated: true }` and `{ was: 'x', deleted: true }` are compile errors.

## 3. The contract section

### 3.1 Shape

- **R3.1** The framework declares the section opaquely, because `packages/1-framework` may not use family vocabulary (`.agents/rules/no-family-vocabulary-in-framework.mdc`). `Contract` (`packages/1-framework/0-foundation/contract/src/contract-types.ts`) gains `readonly hints?: JsonObject` with the doc comment `Planner hints from the authoring layer. Family-defined shape; never hashed; stripped from snapshots.`
- **R3.2** The SQL shape lives in `packages/2-sql/1-core/contract/src/hints.ts`:

  ```ts
  export interface SqlContractHints { readonly namespaces: Readonly<Record<string, SqlNamespaceHints>>; }
  export interface SqlNamespaceHints { readonly tables: Readonly<Record<string, SqlTableHints>>; }
  export type SqlTableHints =
    | { readonly was: string; readonly deleted?: undefined; readonly control?: undefined; readonly columns?: Readonly<Record<string, SqlColumnHint>> }
    | { readonly was?: undefined; readonly deleted: true; readonly control?: ControlPolicy; readonly columns?: undefined }
    | { readonly was?: undefined; readonly deleted?: undefined; readonly control?: undefined; readonly columns: Readonly<Record<string, SqlColumnHint>> };
  export type SqlColumnHint = { readonly was: string; readonly deleted?: undefined } | { readonly was?: undefined; readonly deleted: true };
  export function sqlContractHints(contract: Contract<SqlStorage>): SqlContractHints | undefined;
  ```

  `sqlContractHints` returns `contract.hints` narrowed with `castAs<SqlContractHints>` after the validator of R3.9 has run, which is the only path by which a `Contract<SqlStorage>` exists.
- **R3.3** Keys: `namespaces` by contract namespace id, exactly as `storage.namespaces`; `tables` by the table's storage name in the destination contract for `was` and column-only entries, and by the tombstone's storage name for `deleted` entries; `columns` likewise for columns. A `columns` container is present only when non-empty; `tables` likewise.
- **R3.4** Example for the schema in `spec.md`, in canonical key order (keys are sorted, so `columns` precedes `was`):

  ```json
  "hints": {
    "namespaces": {
      "public": {
        "tables": {
          "Legacy": { "deleted": true },
          "User": { "columns": { "firstName": { "was": "first_name" } }, "was": "Profile" }
        }
      }
    }
  }
  ```

### 3.2 Canonicalization, hashing, emission

- **R3.5** `canonicalization.ts`: `hints` joins `TOP_LEVEL_ORDER` immediately after `defaultControlPolicy` and before `meta`. `canonicalizeContractToObject` spreads it with `ifDefined('hints', ...)`. `omitDefaults` applies as to any object; because R2.7 never emits an empty container, no partially-emptied entry can arise. A contract with no hints canonicalizes byte for byte as before, so `pnpm fixtures:check` sees no churn.
- **R3.6** `hashing.ts` is unchanged; no hash function receives `hints`. The test (`packages/2-sql/2-authoring/contract-psl/test/interpreter.hint-attribute.test.ts`) asserts that the emitted `storage.storageHash`, `execution.executionHash` and `profileHash` of a schema with hints and tombstones equal those of the same schema with the hints removed and the tombstones deleted.
- **R3.7** `emit` (`packages/1-framework/3-tooling/emitter/src/emit.ts`) writes the canonicalized object, so `hints` lands in `contract.json` between `defaultControlPolicy` and `meta`, before the appended `_generated`.
- **R3.8** `generateContractDts` (`emitter/src/generate-contract-dts.ts`) declares no `hints` member. A test asserts the rendered `contract.d.ts` for a contract with hints contains no occurrence of `hints`. `packages/2-sql/2-authoring/contract-ts/schemas/data-contract-sql-v1.json` is regenerated with `pnpm schemas:generate` after R3.9 and its drift test passes.

### 3.3 Validation

- **R3.9** `createSqlContractSchema` (`packages/2-sql/1-core/contract/src/validators.ts`) gains `'hints?': sqlContractHintsSchema`, an arktype type matching R3.2 exactly: unknown keys rejected at every level, `was` a non-empty string, `deleted` the literal `true`, `control` one of the four policies, the arm exclusivity enforced.
- **R3.10** `assertContractHintsConsistent(contract: Contract<SqlStorage>): void`, in `hints.ts`, throws `contractError('CONTRACT.HINT_INVALID', ...)` (code added to `packages/2-sql/1-core/contract/src/contract-errors.ts`) when any of these fails:
  1. every `namespaces` key exists in `storage.namespaces`, or every entry under it is a `deleted` table entry;
  2. a `was` or column-only table entry's key exists in that namespace's `entries.table`;
  3. a `deleted` table entry's key does not exist there;
  4. a `was` column entry's key exists in the table's `columns`;
  5. a `deleted` column entry's key does not exist there;
  6. no `was` equals a table (or, for columns, a column) declared in the same namespace (table), and no two entries in one scope share a `was`.
  Message: `Contract hints: <scope> "<name>" <rule>.` with `<rule>` one of `is marked deleted but the contract still declares it`, `carries a hint but the contract does not declare it`, `claims it was "<was>", which the contract also declares`, `and "<other>" both claim they were "<was>"`, `names namespace "<ns>", which the contract does not declare`; `<scope>` is `table` or `column "<table>".`.
  The framework CLI cannot import it, so it is exposed through an optional family-instance capability `validateAuthoredContract(contract: Contract): void` on `ControlFamilyInstance` (`framework-components`, with a type guard `hasAuthoredContractValidation` in the style of `hasOperationPreview`); the SQL family implements it as this function, Mongo does not implement it. `validateLoadedContract` (`contract emit`, `contract print`) widens its `familyInstance` parameter from the current `Pick<..., 'deserializeContract'>` to the full `ControlFamilyInstance<string, unknown>` and calls the capability, when present, on the contract `deserializeContract` returns; `resolveHints` (R5.0) calls the function directly. The serializer never calls it, so the application runtime, which deserializes `contract.json` at startup, never fails on a stale hint.
- **R3.11** The Mongo validator (`packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts`) is unchanged and keeps rejecting a `hints` key. The Mongo PSL interpreter already rejects `@@hint` / `@hint` (`PSL_UNSUPPORTED_MODEL_ATTRIBUTE` / `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`); the Prisma 7 and Prisma 6 sources already reject them (`PSL.PRISMA7_UNKNOWN_ATTRIBUTE`, `PSL.PRISMA6_MONGO_UNKNOWN_ATTRIBUTE`). One test in each pins the rejection.

### 3.4 Stripping

- **R3.12** `stripContractHints(contractJson: unknown): unknown` in `packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts` returns the object without its top-level `hints` key. `writeContractSnapshot` applies it before `canonicalizeJson`, so every caller (`migration plan`, `migration new`, ref advancement from `db init` / `db update` / `db sign` / `migrate`, the extension seed phase) writes hint-free snapshots. The marker row's `contract_json` is written as `null` today and stays so; the Postgres ledger upsert that writes `entry.destinationContractJson` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts`, the single site near line 554 today) applies `stripContractHints` to that value first. SQLite stores no contract JSON, so nothing is stripped there. The content verifier reads only `target`, `targetFamily` and `storage` and is unaffected. Tests: a snapshot, and the Postgres ledger row, written from a contract with hints read back without them.
- **R3.13** Migration directories contain no contract file; the content-addressed store holds the snapshots ([ADR 232](../../docs/architecture%20docs/adrs/ADR%20232%20-%20A%20migration%20is%20authored%20against%20its%20start%20and%20end%20contract%20snapshots.md) predates that and is amended at close-out). A migration's `startContract` / `endContract` views never carry hints.
- **R3.14** `migration plan --to <ref>` and `db update --to <ref>` take their destination from the store, so they plan without hints. The CLI reference says under both flags: `A destination named by --to is a snapshot and carries no hints; hints apply only when the destination is the emitted contract.json.`
- **R3.15** `contract infer` never emits hints. `contract print` (Postgres is the only target implementing it) renders the section so an emitted contract round-trips: `@@hint(was: "<was>")` after `@@map` on the model, `@@control` after it if the entry carries `control`; `@hint(was: "<was>")` after `@map` on the field; a table tombstone as `model <name> { @@map("<map>")? @@hint(deleted: true) }` where `{ name, map }` is `toModelName(table)` from `packages/2-sql/9-family/src/core/psl-contract-infer/name-transforms.ts` and `@@map` is printed exactly when `map` is defined; a column tombstone as `<name> String @map("<map>")? @hint(deleted: true)` where `{ name, map }` is `toFieldName(column)` from the same module and `@map` is printed exactly when `map` is defined (the type is ignored by R1.23).

### 3.5 Where hints travel

- **R3.16** Hints reach the planner on the `Contract` object (`contract.hints`). `MigrationPlanner.plan()` gains no parameter. `db update`, `db init` and `migration plan` already pass the deserialized emitted contract; nothing in the CLI changes to carry hints.
- **R3.17** An extension's own `contract.json` may carry hints, but the per-space planner never runs for an extension space (their migrations are pre-built; `ignoreGraphFor` holds only the app space), so such hints are inert. The seed phase strips them (R3.12). No diagnostic. Recorded as a known limitation in the Migration System subsystem doc.

## 4. Planner input: origin and ownership

- **R4.1** `packages/2-sql/9-family/src/core/migrations/hints.ts` declares:

  ```ts
  export interface HintOrigin {
    hasTable(namespaceId: string, table: string): boolean;
    hasColumn(namespaceId: string, table: string, column: string): boolean;
  }
  ```

  Postgres implements it in `core/migrations/hint-origin.ts` over `PostgresDatabaseSchemaNode`, mapping `namespaceId` through `resolveDdlSchemaForNamespaceStorage(contract.storage, namespaceId)`; SQLite implements it in the same-named file over `SqlSchemaIR`, ignoring `namespaceId`.
- **R4.2** Hints are resolved under every policy, but what they produce depends on it (R5.2 to R5.5). Renames are `widening`; drops are `destructive`. A hint the policy cannot act on is ignored, never refused.
- **R4.3** Ownership: `SchemaOwnership` (`control-migration-types.ts`) gains `ownerOf(coordinate: SchemaEntityCoordinate): string | undefined`, returning the id of the space that declares the entity; the aggregate implements it beside `declaresEntity`. `resolveHints` receives the planner's `ownership` (possibly `undefined`). A `was` whose old table has an owner other than `input.spaceId` is a conflict (R5.6, reason `foreign`) naming that owner.

## 5. Resolution

Implemented once, in `hints.ts` of the SQL family:

```ts
export function resolveHints(input: {
  readonly contract: Contract<SqlStorage>;
  readonly origin: HintOrigin;
  readonly policy: MigrationOperationPolicy;
  readonly ownership: SchemaOwnership | undefined;
  readonly spaceId: string;
}): ResolvedHints;

export interface ResolvedColumnRename { readonly namespaceId: string; readonly table: string; readonly originTable: string; readonly from: string; readonly to: string; }
export interface StatedTableDrop { readonly namespaceId: string; readonly table: string; readonly control: ControlPolicy | undefined; }
export interface StatedColumnDrop { readonly namespaceId: string; readonly table: string; readonly column: string; }
export interface ResolvedHints {
  readonly tableRenames: readonly ResolvedTableRename[];   // the type exported by apply-table-rename.ts on pr-30331: { namespaceId, from, to }
  readonly columnRenames: readonly ResolvedColumnRename[];
  readonly tableDrops: readonly StatedTableDrop[];
  readonly columnDrops: readonly StatedColumnDrop[];
  readonly conflicts: readonly SqlPlannerConflict[];
}
```

- **R5.0** `resolveHints` first calls `assertContractHintsConsistent` (R3.10); a throw propagates as a planner failure with one conflict `kind: 'hintRejected'`, `summary` the error message, `meta.code: 'CONTRACT.HINT_INVALID'`.
- **R5.1** Entries are visited in code-point order of their keys: namespaces, then tables within a namespace, then columns within a table. Output arrays preserve that order.
- **R5.2 Table `was`.** `old = was`, `new = table key`. Exactly one applies:
  - origin has `old`, not `new`: if the policy includes `widening`, push `{ namespaceId, from: old, to: new }`; otherwise nothing (a hint that cannot apply is ignored; under `db init`'s additive-only policy the new table is created and the old one is left as it is).
  - origin has `new`, not `old`: spent, nothing.
  - origin has neither: nothing.
  - origin has both: conflict, reason `contradicted`.
  R4.3's ownership check runs before the four cases.
- **R5.3 Table `deleted`.** If the origin has the table and the policy includes `destructive`: push `{ namespaceId, table, control }`. Otherwise nothing.
- **R5.4 Column `was`.** `originTable` is the enclosing table entry's `was` when R5.2 pushed a rename for it, else the table key. If the origin lacks `originTable`, nothing. Otherwise the four cases of R5.2 apply to `hasColumn(namespaceId, originTable, old)` and `hasColumn(namespaceId, originTable, new)`, pushing `{ namespaceId, table: <table key>, originTable, from, to }`. `table` is the destination name, because the table rename is applied before the column rename runs (R6.4).
- **R5.5 Column `deleted`.** With `originTable` as in R5.4: if the origin has the column and the policy includes `destructive`, push `{ namespaceId, table: <table key>, column }`.
- **R5.6 Conflicts.** `SqlPlannerConflictKind` gains `'hintRejected'`. One conflict per rejected hint:

  | reason | `meta.code` | summary | why |
  | --- | --- | --- | --- |
  | `contradicted` | `MIGRATION.HINT_CONTRADICTED` | `MIGRATION.HINT_CONTRADICTED: the rename hint on table "<new>" (was "<old>") cannot apply: namespace "<ns>" has both "<old>" and "<new>".` | `A rename hint applies only while the old name exists and the new one does not. If "<old>" was already renamed, remove the hint. If "<old>" is a different table that should stay, remove the hint and give the model another table name. If "<old>" should be dropped, remove the hint and state the drop with a deleted hint on a model mapped to "<old>".` |
  | `foreign` | `MIGRATION.HINT_FOREIGN_TABLE` | `MIGRATION.HINT_FOREIGN_TABLE: the rename hint on table "<new>" (was "<old>") names a table that contract space "<space>" owns.` | `A hint may rename only tables this contract space declares. Remove the hint, or move the table into this space first.` |

  Column forms substitute `the rename hint on column "<table>"."<new>" (was "<old>")` and `table "<table>" has both ...`; `location` is `{ namespaceId, entityKind: 'table', entityName: <table key> }` plus `column: <new>` for columns; `meta` also carries `from`, `to`, and `column` when applicable. The conflicts are returned, not thrown; the planner fails early (R6.1). Each code gets an error-reference entry.
- **R5.7** Resolution reads the destination contract, `HintOrigin` and `ownership` only. It never reads `fromContract`, a snapshot or the source file.
- **R5.8** Resolution is pure and total: every hint ends in exactly one of rename, drop, ignored or conflict.
- **R5.9 Composition.** R5.4 and R5.5 reading `originTable` is the resolution rule: a model rename and field hints on that model resolve as the table rename followed by column operations whose lookups use the old table name and whose operations use the new one. At planning and in the facade alike, the table rename is applied to the working schema before the column renames on that table are computed (R6.0).

## 6. Applying renames in the planner and in the facade

Renames are applied to a working schema before anything else is planned, so the diff sees the renamed objects as matching and plans only what remains. The same stepping serves the planner and the hand-written migration facade, which is what makes a planned migration file re-emit to the same operations.

### 6.0 The working state, shared by planner and facade

- **R6.0** Each target adds `core/migrations/schema-working-state.ts` exporting a class `WorkingSchema` over the target's schema IR (`PostgresDatabaseSchemaNode`, `SqlSchemaIR`) with `current: TSchema` and `apply(call): void`, which replaces `current` with a copy on which the call's effect has been applied (R6.7, R6.14). The planner starts it from the origin schema; the facade starts it from `contractToSchema(startContract)`. Every rename call is computed against `working.current` and the destination schema, then applied, so a later call sees the effect of an earlier one. This is the order dependence between facade calls: `this.renameTable({ table: 'Profile', to: 'User' })` followed by `this.renameColumn({ table: 'User', column: 'first_name', to: 'firstName' })` works because the second call resolves `User` against the working state the first call advanced. The reverse order fails with `MIGRATION.COLUMN_RENAME_UNMATCHED` naming table `User` as absent, which is the correct report for a wrongly ordered migration.
- **R6.1** Planner sequence, in both planners, immediately after `ensureAdditivePolicy` and before the diff: `hints = resolveHints(...)`; if `hints.conflicts` is non-empty, return `plannerFailure(hints.conflicts)` without diffing; otherwise `working = new WorkingSchema(origin)`, then for each table rename in `hints.tableRenames` in order, then for each column rename in `hints.columnRenames` in order, compute the call (R6.6 / R6.11), `working.apply(call)`, and collect the call; the diff then runs on `working.current`. The case guard (R9) therefore never sees a hinted rename. `planHintRenames` in `core/migrations/hint-renames.ts` is the function that does this loop and returns `{ calls, origin: working.current, consumed, warnings }`.
- **R6.2** Facade sequence: `PostgresMigration` and `SqliteMigration` hold a lazily created `WorkingSchema` seeded from `this.startContract`. `renameTable` and `renameColumn` compute their call against it, apply it, and return the call's ops. A facade method called when the migration has no start contract refuses as the PR's `renameTable` does today (`MIGRATION.TABLE_RENAME_UNMATCHED`, reason `the migration has no start contract`).
- **R6.3 One call, several ops.** A rename call's ops are the rename itself followed by its companion renames (R6.8, R6.13). `OpFactoryCall` (framework, `control-migration-types.ts`) gains `toOps?(lowerer?: unknown): readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[]`; `renderOps` in each target (`render-ops.ts`) passes the lowerer to `toOps` exactly as it passes it to `toOp`, and uses `toOps` when present and `[toOp(lowerer)]` otherwise. `RenameTableCall` and `RenameColumnCall` carry their companions as a constructor argument and implement `toOps`; the companions never appear in the plan's call list and are never rendered. `renderTypeScript()` renders only the facade call: `...this.renameTable({ schema?, table, to })` / `...this.renameColumn({ schema?, table, column, to })`.
- **R6.4 Where this is going.** Rendering a migration file as a sequence of order-dependent facade calls is the first step of the direction the team has discussed: migration issues and operations carrying dependency information so they form a graph, and `migration.ts` being an ordered walk of that graph. The contract-free migration planning project ([`projects/contract-free-migration-planning/spec.md`](../contract-free-migration-planning/spec.md)) adds `dependsOn` to issues and orders operations by it. This project does not add dependency data; it only guarantees that the order it emits is one a walk of that future graph would also produce (table rename before column renames on that table, and renames before the main plan), so nothing here has to be undone. No further operation is pulled into a rename call; a rename call carries only the renames of names derived from the renamed name.
- **R6.5 Consumed hints.** `ConsumedHint` is a framework type in `control-migration-types.ts`, built on `SchemaEntityCoordinate`:

  ```ts
  export interface ConsumedHint {
    readonly kind: 'renamed' | 'deleted';
    readonly coordinate: SchemaEntityCoordinate;   // the table, with entityKind 'table'
    readonly memberName?: string;                  // the column, when the hint is on a column
    readonly from?: string;                        // the old name, when kind is 'renamed'
  }
  ```

  `MigrationPlan` gains `readonly consumedHints?: readonly ConsumedHint[]`, carried by `TypeScriptRenderablePostgresMigration` and `TypeScriptRenderableSqliteMigration`.
- **R6.6 Order of the plan's calls:** hint table renames, hint column renames, then the existing order (Postgres: structural calls, index and check renames, RLS calls, field-event calls; SQLite: replaced indexes, planned calls, field-event calls).
- **R6.7 Control policy.** Before computing a rename, `planHintRenames` resolves the effective control policy of the destination table (`controlPolicyForCall` with the destination contract). If it is not `managed`, no rename can be planned, so the hint is ignored and a planner warning is recorded: `SqlPlannerConflict` with `kind: 'controlPolicySuppressedCall'`, summary `rename hint on table "<new>" (was "<old>") ignored: the table's control policy is <policy>, which does not permit renaming it.`, `location` the table. The warning reaches `migration plan` through R10.3 and `db update` through its existing warning output. The old table then follows the normal path: it is absent from the contract, so the main diff plans its drop, which is a destructive operation and goes through consent like any other.

### 6.1 Applying a call to the working schema

- **R6.8** `renameTableInPostgresSchema(schema, rename): PostgresDatabaseSchemaNode` returns a copy with: the table node re-keyed and renamed; every foreign key in every table of every namespace whose referenced table is `(schema, from)` retargeted to `to` (a foreign key whose `referencedSchema` is undefined refers to its own table's schema); every `PostgresPolicySchemaNode` whose `tableName` is `from` rewritten to `to`; every `dependsOn` reference naming the old table rewritten; the RLS flag carried over. Constraint, index, check and policy names are unchanged (the companions rename them). `WorkingSchema.apply` handles `RenameTableCall` (through this function, then each companion), `RenameConstraintCall`, `RenameIndexCall`, `RenamePostgresRlsPolicyCall` (re-key and rename the matching node and every `dependsOn` reference to it), `RenameColumnCall` (R6.14), and on SQLite the index replacement pairs (applied as a rename of the index node). The SQLite form is `renameTableInSqliteSchema`.

### 6.2 Table rename

- **R6.9** `postgresTableRenameCalls` on `pr-30331` (`table-rename-calls.ts`) is replaced by:

  ```ts
  export function postgresTableRenameCall(input: {
    readonly previous: PostgresDatabaseSchemaNode;   // working.current, with the table under its OLD name
    readonly next: PostgresDatabaseSchemaNode;       // destination schema
    readonly contract: Contract<SqlStorage>;
    readonly rename: ResolvedTableRename;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>;
  }): RenameTableCall
  ```

  It renames the table in a copy of `previous` (R6.8), diffs that against `next`, and returns the `RenameTableCall` with companions `[...constraintRenamesForTableRename(...), ...pairIndexRenames(...).calls on the renamed table, ...pairCheckRenames(...).calls on the renamed table]`. The facade's `renameTable` resolves the start-contract checks the PR performs today (`resolveTableRename` in `apply-table-rename.ts`, unchanged, run against `this.startContract` and `this.endContract`) and then calls this function with `previous = working.current`. `applyTableRename` and its contract rewriting are deleted: the working schema replaces them. The SQLite form is `sqliteTableRenameCall({ previous, next, contract, rename, frameworkComponents })` with companions `pairIndexReplacements(...)` on the renamed table, as the PR computes them; a case-only rename goes through the temporary name exactly as the PR's `renameTableSteps` does.
- **R6.10 Constraint companions.** For each primary key, unique and foreign key on the renamed table in `previous`, find the destination constraint on the renamed table in `next` with the same kind, the same columns after mapping every rename applied so far (table and columns), and for foreign keys the same referenced table and columns after mapping. If none, the constraint is being dropped or changed and is left alone. If one, the target name is the destination constraint's explicit `name` when it has one, else the default name derived from the new table and column names (`defaultPrimaryKeyName`, `defaultUniqueName`, `defaultForeignKeyName` in `default-constraint-names.ts` on `pr-30331`). Emit a `RenameConstraintCall` from the origin's actual name to the target name when they differ. This replaces the PR's `name === undefined` test, which an introspected origin never satisfies; the destination contract is the only source for "does Prisma derive this name", and the origin's actual name is the only source for "what is it called now". Foreign keys on other tables pointing at the renamed table are not on the renamed table and are not renamed. Indexes and checks are paired by `pairIndexRenames` / `pairCheckRenames` (same prefix and content hash); policies follow the table through the schema rewrite of R6.8 and keep their names.

### 6.3 Column rename

- **R6.11 Operation.** Postgres `RenameColumnCall(schemaName, tableName, oldColumnName, columnName, companions)`: `factoryName 'renameColumn'`, `operationClass 'widening'`, label `Rename column "<old>" to "<new>" on table "<table>"`, renders `...this.renameColumn({ schema?, table, column: old, to: new })` (schema omitted when unbound, as `renameTable` does), `toOps(lowerer)` = `[op, ...companions.map(c => c.toOp(lowerer))]`, op id `renameColumn.<table>.<old>`, target `targetDetails('column', new, schema, table)`, precheck `ensure column "<old>" exists on table "<table>"` and `ensure column "<new>" does not exist on table "<table>"`, execute `ALTER TABLE <qualified> RENAME COLUMN "<old>" TO "<new>"`, postcheck `verify column "<new>" exists on table "<table>"` and `verify column "<old>" no longer exists on table "<table>"`. `classifyCall` maps `'renameColumn'` to `'column'`. SQLite `RenameColumnCall(tableName, oldColumnName, columnName, companions)`: the same with `ALTER TABLE "<t>" RENAME COLUMN "<old>" TO "<new>"`; when `sqliteIdentifiersCollide(old, new)`, two statements through `_prisma_rename_<new>` with the extra precheck `ensure column "_prisma_rename_<new>" does not exist on table "<t>"`.
- **R6.12 Facade.** `PostgresMigration.renameColumn({ schema?, table, column, to })` and `SqliteMigration.renameColumn({ table, column, to })` resolve against `working.current` (R6.0, R6.2) and `this.endContract`, compute the call through R6.13, apply it, and return its ops. They refuse with `sqlFamilyError('MIGRATION.COLUMN_RENAME_UNMATCHED', ...)` (code added to `SqlFamilyErrorCode` in `packages/2-sql/9-family/src/core/errors.ts`) with message `renameColumn "<column>" to "<to>" on table "<table>" does not match the migration's contracts: <reason>.`, `why` `renameColumn must name a column of a table as the migration's earlier operations leave it, and a new name that the end contract has and the start contract does not. Order a renameTable before the renameColumn calls on its table, make the rename its own schema change, and check the spelling, the table and the namespace.`, `meta: { table, from, to }`, and `<reason>` one of `table "<table>" does not exist at this point of the migration`, `column "<column>" does not exist on table "<table>" at this point of the migration`, `column "<to>" already exists on table "<table>" at this point of the migration`, `column "<to>" does not exist on table "<table>" in the end contract`, `table "<table>" is declared in more than one namespace (<list>); name its namespace`.
- **R6.13 Companions.** `postgresColumnRenameCall({ previous, next, contract, rename: ResolvedColumnRename, frameworkComponents })` returns the `RenameColumnCall` with companions:
  1. constraints, by R6.10 applied to the column's table with the column rename as the mapping: for each unique and foreign key on the table whose columns include the renamed column, the matching destination constraint (same kind, same columns after mapping, same reference after mapping) gives the target name; emit `RenameConstraintCall` when it differs from the origin's actual name. The primary key's default name carries no column names, so it is renamed only when the destination gives it an explicit name that differs.
  2. for each index on the table whose column list contains the renamed column, that has no `expression` and no `where`, and whose destination index (columns mapped through the rename) matches in uniqueness, type and options: `RenameIndexCall` from the origin's physical name to the destination's physical name. Both prefix and hash differ ([ADR 243](../../docs/architecture%20docs/adrs/ADR%20243%20-%20Name-identified%20indexes%20and%20exact-name%20adoption.md)); pairing is by shape.
  3. nothing for expression indexes, partial indexes, check constraints and RLS policies whose body mentions the column: the bodies are opaque text. The main diff drops and recreates them, which is `widening` (R7.0). The CLI reference and the slice's upgrade fragment say so.
  4. nothing for foreign keys on other tables whose referenced columns include the renamed column: their names derive from their own columns, and Postgres updates the reference.
  SQLite: companions are `pairIndexReplacements` matching by shape (columns mapped through the rename, uniqueness, `where`) rather than by name.
- **R6.14** `WorkingSchema.apply` learns `RenameColumnCall`: re-key and rename the column node, and rewrite the column name inside every primary key, unique, foreign key (local columns, and referenced columns on other tables) and index of the schema, and every `dependsOn` reference to it.

## 7. Stated drops

- **R7.0 Destructive means data is lost.** An operation is `destructive` only when applying it loses rows or values that the contract cannot recreate: dropping a table, dropping a column, and narrowing a column's type or nullability. Drops of indexes, unique constraints, foreign keys, check constraints and row-level-security policies lose nothing the contract cannot recreate and are `widening`. On Postgres `DropIndexCall`, `DropConstraintCall`, `DropCheckConstraintCall` and `DropPostgresRlsPolicyCall` are reclassified from `destructive` to `widening`; on SQLite `DropIndexCall` is, and the index replacement pair is therefore `widening` as a whole. Consequence: `db update` no longer asks for consent for any of these, and `migration plan`'s refusal (R8.2) never lists one. This is a user-visible change recorded in slice 1's upgrade fragment. A policy drop loses no data but widens access; that is a different concern from consent for data loss and may get its own flag later, outside this project.
- **R7.1** Drops are not emitted by the hint machinery. The main diff emits `DropTableCall` / `DropColumnCall` for `not-expected` issues as today. After `planIssues`, the planner walks the calls; for each destructive drop call it reads the subject's table and column names from the call, decides per R7.3, and replaces a stated call with `call.withStatedIntent()`, which returns a new frozen instance of the same class with `statedIntent: true` (calls are frozen in their constructors and cannot be mutated).
- **R7.2** `MigrationPlanOperation` (framework) gains `readonly statedIntent?: true`, and `MigrationOpSchema` (`packages/1-framework/3-tooling/migration/src/op-schema.ts`) gains `'statedIntent?': 'true'`. The destructive calls take `statedIntent: boolean` as a constructor argument and expose `withStatedIntent()` (R7.1): on Postgres `DropTableCall` and `DropColumnCall`; on SQLite `DropTableCall`, `DropColumnCall` and `RecreateTableCall`. Their `toOp()` sets the field when true; their `renderTypeScript()` adds `statedIntent: true` to the facade call's options object when true; the facade methods (Postgres `dropTable`, `dropColumn`; SQLite `dropTable`, `dropColumn`, `recreateTable`) accept `statedIntent?: true` and pass it through, so re-emitting a planned migration reproduces the same ops and the same `migrationHash`.
- **R7.3** A destructive drop is stated when its subject is a table in `hints.tableDrops` or a column in `hints.columnDrops`. On SQLite, a `RecreateTableCall` whose only destructive effect is dropping stated columns is stated (R7.6). Nothing else needs stating, because after R7.0 every other drop a hint can cause is `widening`.
- **R7.4** A stated drop of a hinted table or column is reported as consumed `{ kind: 'deleted', coordinate, memberName? }`. A `deleted` hint whose drop was suppressed by control policy or ownership is not consumed and produces no diagnostic.
- **R7.5** Control on tombstones: when the planner resolves the control policy of a `not-expected` table whose name is in `hints.tableDrops`, it uses that entry's `control` before the contract default (`resolvePostgresNodeIssueControlPolicySubject` and the SQLite equivalent consult `hints.tableDrops`). So a table that was `external` or `observed` and is now a tombstone is still never touched, and a `tolerated` one is never dropped.
- **R7.6** On SQLite a column drop is a plain `DropColumnCall`. SQLite refuses `DROP COLUMN` on a column that is indexed, unique, part of the primary key, or referenced by a foreign key. For such a column the planner routes the drop through `RecreateTableCall` with `statedIntent` propagated to the recreate op. Whether `RecreateTableCall` needs a new classification branch for column `not-expected` issues is settled by the slice 4 spec after reading `recreate-table` on `main`; the behaviour above is fixed.

## 8. Consent

- **R8.1** An operation is destructive-for-consent when `operationClass === 'destructive' && statedIntent !== true`. `stripOperations` (`cli/src/control-api/operations/migration-helpers.ts`) keeps `statedIntent` and `target` in addition to `id`, `label` and `operationClass`, so the operations `wrapPlanResult` (`db-run.ts`, near line 416) exposes carry both; `guardDestructiveChanges` (`db-update.ts`) filters on the predicate above. A plan whose only destructive operations are stated runs with no prompt.
- **R8.2** `migration plan` gains the refusal on the delta leg. The sequence in `executeMigrationPlan` becomes: seed phase (extension packages, as today, may write) → resolve origin and destination → plan the auto-baseline leg if any → plan the delta leg → consent check over both legs → write the destination snapshot and the app-space packages. The consent check: collect destructive-for-consent operations of both legs; if any and `options.consent` is undefined, return `errorDestructiveChanges(summary, { why, fix, meta })` with
  - summary `The migration contains <n> destructive operation(s) that require confirmation` (`The baseline and the migration contain ...` when both legs contribute);
  - `why`: one line per operation, `<label>: <advice>` with `<advice>` from R8.4, joined by `\n`;
  - `fix`: `State the intent in the schema with the hints above and plan again, or re-run \`prisma migration plan\` and type the project directory name when asked, or pass \`--no-interactive --confirm <directory>\` where there is nobody to ask.`;
  - `meta: { destructiveOperations, planHash, leg: 'baseline' | 'delta' | 'both' }` where `planHash = computePlanHash({ operations: [...baselineOps, ...deltaOps].map(projectOp), destination: { storageHash: toHash } })` and `projectOp` is `({ id, label, operationClass, statedIntent }) => ({ id, label, operationClass, statedIntent })` in `plan-identity.ts`, used by `migration plan`, by `guardDestructiveChanges`, and by the apply-path hash in `db-run.ts` (near line 247), which today uses `stripOperations`. The hash is only ever compared within one invocation pair, so nothing user-visible changes.
  With consent, both legs are re-planned, the hash recomputed, and `errorConsentPlanMismatch` returned on a difference. The consent token is the project directory name through `consentToken(ctx.cwd)`. The handler in `orm/migration/plan.ts` reads `meta.leg` to pick the question: `Write a baseline migration containing <n> destructive operation(s)? ...` (existing) for `baseline`, `Write a migration containing <n> destructive operation(s)? Applying it would remove data that cannot be recovered:` for `delta` and `both`, each followed by `destructiveOperationList`. No app-space package and no destination snapshot is written before the check passes; extension seed artifacts may already be written, as with today's baseline refusal.
- **R8.3** With `--to <ref>` the destination carries no hints, so `why` lines use the no-hint advice of R8.4 and `fix` omits the first clause.
- **R8.4 Advice.** The CLI (framework) cannot name tables or import the SQL family, so advice is produced by a family-instance hook `ControlFamilyInstance.describeDestructiveOperation(op: MigrationPlanOperation): { advice: string }`, added to the control family instance interface in `framework-components`, implemented once in the SQL family (`hint-advice.ts`), keyed on the op id prefix, which is distinct on both targets (`dropTable.` and `dropColumn.`), with the table and column names read from `op.target.details`. `SqlPlanTargetDetails` (`packages/2-sql/9-family/src/core/migrations/types.ts`) gains `readonly objectType: string` and `readonly table?: string`, which both targets already set, so the family reads them without casts. Mongo ops carry `target` as a string and the Mongo implementation never reads it. The advice:
  - table drop: `add a deleted hint to a model mapped to "<X>" (@@hint(deleted: true) in PSL, sql({ hint: { deleted: true } }) in TypeScript), or a rename hint (@@hint(was: "<X>") / sql({ hint: { was: "<X>" } })) to the model that replaced it`
  - column drop on `T`: `add a deleted hint to a field mapped to "<c>" on the model for "<T>" (@hint(deleted: true) / .hint({ deleted: true })), or a rename hint (@hint(was: "<c>") / .hint({ was: "<c>" })) to the field that replaced it`
  - any other destructive operation: `no hint expresses this change; consent at the command, or author the migration by hand`
  Before slice 4 ships `deleted`, the table and column advice omit the deleted clause and read `add a rename hint (...) to the model that replaced it, if "<X>" was renamed; otherwise consent at the command`. With no hints possible (R8.3): `consent at the command`. Mongo's family instance returns `consent at the command` for every op.
- **R8.5** `db update`'s refusal `why` becomes the same per-operation list, built with the same hook, so both commands read alike. Its `fix` is the existing database-name consent instruction.
- **R8.6** `migrate` is unchanged: it replays `ops.json` and consults neither consent nor hints.

## 9. The verbatim guard

- **R9.1** `detectTableNameCaseChanges` (`table-name-case-guard.ts`, `pr-30331`) gains a first remedy at the start of `why`: `To rename the table and keep its rows, add a rename hint to model <created> (@@hint(was: "<dropped>") in PSL, sql({ hint: { was: "<dropped>" } }) in TypeScript) and plan again; the planner renames the table and the objects named after it. Or, to keep table "<dropped>" and its rows, ` followed by the existing text from `add @@map(...)` onward, unchanged. The guard runs on the adjusted origin (R6.0), so a hinted rename never reaches it.

## 10. Reporting

- **R10.1** `MigrationPlanResult` gains `readonly consumedHints?: readonly { readonly hint: ConsumedHint; readonly text: string }[]`, set from the delta leg when non-empty by `executeMigrationPlanCommand` (`migration-plan.ts`), which holds the family instance and renders `text` through a family-instance hook `describeConsumedHint(hint: ConsumedHint): string` (SQL implementation in `hint-advice.ts`; the command handler in `orm/migration/plan.ts` has no family instance and prints `text` as given). The human output adds, after the operations block, a block titled `Hints applied` with one line per entry:
  - table renamed: `rename hint on table "<new>" (was "<from>"): renamed and recorded in this migration; you can remove the hint.`
  - column renamed: `rename hint on column "<table>"."<new>" (was "<from>"): renamed and recorded; you can remove the hint.`
  - table deleted: `deleted hint on table "<name>": dropped and recorded; you can remove the model.`
  - column deleted: `deleted hint on column "<table>"."<name>": dropped and recorded; you can remove the field.`
  The block is omitted when no hint was consumed.
- **R10.2** `db update` and `db init` print nothing about hints; their operation lists name the renames and drops.
- **R10.3** `runPlannerLeg` forwards each `plannerResult.warnings[i].summary` into `MigrationPlanResult.warnings`, which the human renderer already prints, so control-policy suppressions become visible in `migration plan` as they are in `db update`.

## 11. What does not change

- **R11.1** `db verify`, `db sign`, `migration check`, `migration status`, `migration log`, `migration show`, and the application runtime deserialize the contract through the same serializer, which accepts the section, and ignore it.
- **R11.2** `migration.json` and `computeMigrationHash` are unchanged. Ops carry `statedIntent`; the manifest carries nothing about hints.
- **R11.3** `ownership`, `retainUnownedExtras`, `coalesceSubtreeIssues`, the strategies, RLS planning and field-event planning are untouched and run on the adjusted origin.
- **R11.4** The Mongo family, planner and validator are untouched except for the trivial `describeDestructiveOperation` / `describeConsumedHint` implementations of R8.4 and R10.1.

## 12. Slice map

| Rules | Slice |
| --- | --- |
| R1.1 to R1.12 (model spec with `was` and `deprecated`), R1.14 (`was` clauses), R1.15 to R1.17, R1.19, R2.1 (`was` arm), R2.3 to R2.5 (model rules), R2.7, R3.1 to R3.9, R3.10 items 1, 2 and 6, R3.11 to R3.17, R4, R5.0 to R5.2, R5.6 to R5.8, R6.0 to R6.10, R7.0, R9, R10, R11 | Slice 1 (TML-3422) |
| R1.13, R1.18, R2.2, R2.4 (column clause), R2.5 (field rules), R5.4, R5.9, R6.11 to R6.14, R7.2 (the `statedIntent` field, facade options and schema), R8.1 | Slice 2 (TML-3423) |
| R8.2 to R8.5 with the pre-`deleted` advice text, including R8.3 | Slice 3 (TML-3424) |
| R1.2 `deleted` parameter, R1.14 (`deleted` clause), R1.20 to R1.24, R2.1 and R2.2 `deleted` arms, R2.6, R2.8, R3.10 items 3 and 5, R3.15 tombstone printing, R5.3, R5.5, R7.1, R7.3 (remaining), R7.4 to R7.6, R8.4 final advice text | Slice 4 (TML-3432) |

Every slice ships only grammar that has effect in that slice: slice 1 registers the model attribute with `was` and `deprecated` (`deprecated` has the effect of being refused with its final message); slice 2 registers the field attribute; slice 4 adds `deleted`.

## 13. Tests

Each slice's tests, all red before their change. A slice spec may rename a file but not drop a case.

**Attribute and interpreter** (`packages/2-sql/2-authoring/contract-psl/test/`): `sql-attribute-specs.test.ts` key-set and name/level assertions updated; new `interpreter.hint-attribute.test.ts` with one case per rule R1.6 to R1.24 asserting the exact code and message, the positive cases (model `was` with and without `@@map`, field `was`, both at once, a multi-table variant with `was`, a tombstone with ignored contents and `@@control`), the emitted section equal to R3.4 after `JSON.parse(JSON.stringify(...))`, and R3.6's hash equality. Mongo interpreter, Prisma 7 and Prisma 6 tests pin the existing rejection.

**TypeScript authoring** (`packages/2-sql/2-authoring/contract-ts/test/`): `hint-authoring.test.ts` mirrors the interpreter cases through the builders, asserting `CONTRACT.HINT_INVALID` messages equal to the PSL ones; `hint-authoring.test-d.ts` for R2.8.

**Contract** (`packages/1-framework/0-foundation/contract/test/`, `packages/2-sql/1-core/contract/test/`): canonicalization order of the `hints` key; validator acceptance of R3.4 and rejection of each malformed shape; `assertContractHintsConsistent` one case per item of R3.10; `.d.ts` free of `hints` (R3.8); JSON schema drift test.

**Snapshot store and ledger**: round trips without hints (R3.12) for the store and for the Postgres ledger row.

**Resolution** (`packages/2-sql/9-family/test/hints.test.ts`): a stub `HintOrigin` and `SchemaOwnership`; one case per branch of R5.2 to R5.5; every conflict row of R5.6; R4.3; ordering of R5.1.

**Planner** (`packages/3-targets/3-targets/{postgres,sqlite}/test/migrations/`): `hint-renames.test.ts` asserting, for a table with a primary key, a unique, a foreign key, an index, a check and (Postgres) a policy, all default-named, that the ops planned from an introspected-style origin (names filled) with a hint equal the facade's `renameTable` ops for the same change (R6.9, R6.10), that the working schema diffs to zero further operations, and that `renderTypeScript()` equals the hand-written migration byte for byte (R6.3); a table rename followed by a column rename on it, planned and hand-written in both orders, with the wrong order refused (R6.0); the warning under `tolerated` and the old table's drop reaching consent (R6.7); every drop named in R7.0 classified `widening` on both targets (R7.0); `rename-column-ops.test.ts` and `rename-column-facade.test.ts` for R6.11 to R6.13 including every refusal reason, the case-only rename on SQLite, the opaque-body exclusion, and the composed table-plus-column rename on a shared unique (R6.13 item 1); stated drops marked per R7.3 and unmarked without a hint; control on tombstones (R7.5); the guard's new remedy text (R9).

**CLI** (`packages/1-framework/3-tooling/cli/test/`): `migration plan` refusal on the delta leg, on both legs, consent, mismatch, `meta.leg`, the `why` text, and the `--to` wording (R8.2, R8.3); `db update` no prompt for stated drops (R8.1); `consumedHints` in JSON and the human block (R10.1); warnings forwarded (R10.3).

**Journeys** (`test/integration/test/cli-journeys/`): `hint-rename.e2e.test.ts` (Postgres) and `hint-rename.sqlite.e2e.test.ts`, each the project DoD journey in `spec.md`, and a `hint-deleted` pair for the drop journey. Added to the journeys README table.

**Language server** (`packages/1-framework/3-tooling/language-server/test/`): completion lists include `hint` at the levels registered so far; signature help shows the registered named arguments with the R1.2 documentation.

## 14. Documentation and upgrade artifacts

- `packages/1-framework/3-tooling/cli/README.md`: the `--to` note (slice 1), the `Hints applied` block (slice 1), drops of indexes, constraints, checks and policies no longer need consent (slice 1), the opaque-body rule for column renames (slice 2), the `migration plan` refusal and consent (slice 3).
- `packages/2-sql/2-authoring/contract-psl/README.md`: `@@hint` / `@hint` beside `@@map` and `@@control`, and `PSL_HINT_INVALID`.
- `docs/reference/error-reference.md`: `CONTRACT.HINT_INVALID`, `MIGRATION.HINT_CONTRADICTED`, `MIGRATION.HINT_FOREIGN_TABLE`, `MIGRATION.COLUMN_RENAME_UNMATCHED`, and the extended `MIGRATION.DESTRUCTIVE_CHANGES` entry.
- `skills/prisma-8/references/contract.md` and `references/migrations.md`: replace the "no in-contract rename hint" statements; `skills/journey-tests/02b-rename-with-hint.md` inverts its assertion.
- Upgrade fragments under `upgrade-instructions/pending/`: `intent-hints-model-rename/app` (slice 1; one change: drops of indexes, unique constraints, foreign keys, checks and policies no longer ask for consent in `db update`, plus an entry if an example schema changes), `intent-hints-field-rename/app` (slice 2; same), `migration-plan-refuses-destructive/app` (slice 3; one change: plans with destructive operations now ask for consent, CI passes `--no-interactive --confirm <directory>`), `intent-hints-deleted/app` (slice 4). Released upgrade sources are never edited.
- Close-out: the ADR named in `spec.md`; amendments to ADR 001, ADR 028, ADR 232 and the Data Contract and Migration System subsystem docs.

## 15. Open points for slice specs

None may change a rule above; each is a choice the rule leaves because the code must be read first.

1. Whether `RecreateTableCall` needs a new classification branch to absorb a stated column drop on SQLite (R7.6).
2. The exact call site in `interpretPslDocumentToSqlContract` where tombstones are removed from the model list before `buildModelNodeFromPsl` runs (R1.20).
3. The arktype spelling of the three-arm `SqlTableHints` union (R3.9).
