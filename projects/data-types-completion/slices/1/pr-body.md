Slice 1 of the project "Data types own column types" (Linear TML-3386, planning PR #30518). Base branch: `data-types-completion`.

## At a glance

A Postgres data type now declares, in one place, how the database writes it, how the catalog reports it, which parameters it takes, and their normal form:

```ts
export const pgNumeric = sqlDataType('pg/numeric', {
  params: pgNumericParams,                       // precision 1 to 1000, scale 0 to 1000
  texts: [
    writtenAndCatalog('numeric'),
    written('numeric({precision})'),
    writtenAndCatalog('numeric({precision},{scale})'),
    claimsOnly('decimal'),
    claimsOnly('decimal({precision})'),
    claimsOnly('decimal({precision},{scale})'),
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
  casts: { [pgInt2.id]: asNumeralText, [pgInt4.id]: asNumeralText, [pgInt8.id]: unchanged },
});
```

A type constructor names the codec and maps its arguments onto the data type's parameters. It carries no type name and no bounds of its own:

```ts
Numeric: {
  kind: 'typeConstructor',
  inferred: true,
  args: [
    { kind: 'number', name: 'precision', integer: true, optional: true },
    { kind: 'number', name: 'scale', integer: true, optional: true },
  ],
  output: { codecId: 'pg/numeric@1', typeParams: { precision: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } } },
},
```

Everything that used to compute or copy a column's type name now reads the declaration: the contract writers, both migration planners, the `ALTER COLUMN TYPE` postcheck, the Postgres parameter casts, and the Prisma 7 reader.

## The decision

Every fact about a SQL database type is declared once, on the data type, by the package that owns it (a target such as Postgres, or an extension such as pgvector). Every copy of those facts is deleted. `contract.json` does not change in this slice: the column still stores `nativeType`, but that string is now written from the declaration, and a test proves the DDL of every committed contract is byte-identical.

Before this change the name of a column's database type was written or computed in eight places that disagreed: codec `targetTypes`, the `nativeType()` codec hook, the `expandNativeType` control hooks, a type metadata registry, the adapters' `normalizeNativeType`, the constructor templates' `nativeType`, hand-written descriptors, and the Prisma 7 binding. Adding a type meant editing several tables, extension types were invisible to `contract infer`, and `db verify` compared strings.

## What the declaration holds

- **Texts.** Each text is marked `written` (a migration writes it), `catalog` (the database reports it), both, or neither (it only recognises a reported type). `numeric(10)` is written as `numeric(10)` but reported as `numeric(10,0)`, so `pg/numeric` declares both texts. Placeholders such as `{precision}` name a parameter; only integers may be substituted.
- **Parameters and bounds.** `params` is an arktype object schema and is the only place a bound is written. `pg/numeric` allows a negative scale, as Postgres 15 does. A codec's `paramsSchema` is its data type's `params`, referenced, never restated. Constructor and preset arguments lost their `minimum` and `maximum`; PSL reports a violation at the argument with `PSL_INVALID_ATTRIBUTE_ARGUMENT`, and a TypeScript contract refuses it when it is built with `CONTRACT.TYPE_PARAMS_INVALID`.
- **Normal form.** `normalize` gives the parameters the catalog compares by: `numeric(10)` becomes `{ precision: 10, scale: 0 }`; `char` becomes `{ length: 1 }`. Writing uses the raw parameters, so migration SQL is unchanged.
- **Kinds.** `pg/enum` declares `claimsKind: 'enum'` and a `render` hook that quotes the type name, instead of texts.
- **Casts** stay exactly as they were.

The Postgres target declares every Postgres type, pgvector declares `vector({length})`, postgis declares `geometry` and `geometry(Geometry,{srid})`. SQLite declares `text`, `integer`, `real`, `blob` and two new types, `character` and `character varying`, which the `sql/char@1` and `sql/varchar@1` codecs now name on SQLite. Mongo data types declare the BSON types they are stored as with `mongoDataType`.

## Who declares and who reads

- **Targets declare.** The Postgres and SQLite targets register their data types for both migrations and the runtime, and contribute the PSL entries for them. The scalar type constructors are defined in each target and still contributed by its adapter, so the TypeScript builder's `type.*` helpers do not change.
- **Readers.** Both planners write a column type with `renderSqlTypeName`. `SERIAL`, identity values, JSON defaults and the safe-widening table are keyed by data type id. The Postgres SQL renderer casts a parameter to the type's base name: `$1::integer` becomes `$1::int4`, and a `varchar(255)` column casts as `character varying` with no length, because an explicit cast with a length would truncate.
- **Assembly checks.** A stack is refused when a constructor names a codec no component registers, maps an argument onto a parameter its data type does not declare, or marks two constructors of one data type `inferred`; when two data types' claiming texts would both match one reported type; and when a codec represents a data type that is not a SQL column type. The SQL family's own data type, `sql/expression`, is the type of a written SQL expression and no column has it.
- **Deleted.** `targetTypes`, `targetTypesFor`, `byTargetType`, the `nativeType()` hook and `nativeTypeFor`, every `expandNativeType` hook, `buildNativeTypeExpander`, `typeMetadataRegistry`, `normalizeNativeType`, `validateScalarTypeCodecIds`, `assertSafeNativeType` and `CONTRACT.NATIVE_TYPE_INVALID`. ADR 171 is superseded by ADR 254.

## Behaviour changes to know about

- **Columns that use a `types {}` alias** are written like any column of the aliased type. A `types { Id = Uuid }` alias used to write `"uuid"`, quoted, which Postgres rejects. Now it writes `uuid`. No committed migration contains such a column.
- **The check after `ALTER COLUMN TYPE`** compares the database's reported type with the name Postgres prints for the new type. For an enum that means `"UserRole"` quoted and `user_role` not, whether or not the column goes through an alias. Before, a mixed-case enum name reached through an alias failed this check. Slice 3 replaces the text comparison with a type identity check.
- **Verify reads a column's type in the form the catalog prints.** A `Numeric(10)` column is compared as `numeric(10,0)`, which is what Postgres reports, so it now applies and verifies clean.
- **A NOT NULL list column** added to a non-empty table gets the temporary default `'{}'` instead of `''`, which Postgres refused for an array.
- **The migration marker's `invariants` column** binds `pg/text@1` as a list instead of `pg/text-array@1`, which is never written. DDL and stored rows are identical, so a signed database still verifies.
- **A TypeScript contract must list the extensions whose codecs it uses** (or pass their data types), because the column's type name now comes from the codec's data type. `defineContract` builds the lookups from the target and the listed extensions.
- **A runtime adapter refuses a codec whose data type is not registered** when it is built, rather than on the first query.
- **A placeholder value written into a type name must be an integer.** Rendering refuses anything else, so a data type's parameters can never carry text into DDL.
- **`contract infer` and the PSL printer write a namespaced constructor with no arguments with parentheses**, `postgis.Geometry()`, because the reader treats a dotted name without them as a scalar type. `srid` is optional now, so this case can occur. Names without a namespace are unchanged.
- **One place checks column parameters.** Building a contract validates every column's parameters against its data type and raises `CONTRACT.TYPE_PARAMS_INVALID`; no column helper checks on its own. PSL reports the same violation at the argument, and the `type.*` helpers keep `CONTRACT.ARGUMENT_INVALID`.

## Upgrading

Two entries under `upgrade-instructions/pending/data-types-declare-names/`, both validated by execution against the base commit:

- `extension/instructions.md`: replace `dataType(id)` with `sqlDataType` or `mongoDataType` declarations; delete `targetTypes` and the rendering hooks; point the codec's `paramsSchema` at the data type; drop `nativeType` and bounds from constructor templates; pass `dataTypes` from runtime descriptors; expect `$1::int4` in logged SQL.
- `app/instructions.md`: list the extensions a TypeScript contract uses; re-emit SQLite contracts, whose `contract.d.ts` gains aggregate rows for the two character codecs; column parameter errors are now `CONTRACT.TYPE_PARAMS_INVALID` and are raised when the contract is built.

## Proof

- A golden planner test plans every committed SQL contract plus two fixture contracts with every parameter shape from an empty schema and compares the operations byte for byte with `main`'s planner. It commits one SHA-256 per contract in `test/integration/test/planner-golden/manifest.json`, hashed from recordings made with `main`'s planner; only the two fixture contracts keep their full planner output for review. Of 343 contracts, 340 plan identically; two differ only by the `typeRef` quoting fix and one only by the planner's error code for an unregistered codec.
- Per package, a test lists every registered data type and asserts its declaration; every bound is tested at its edges; `normalize` applied twice equals once.
- `pnpm fixtures:check` shows no contract change. The framework vocabulary count fell from 272 to 262.
- The Postgres runtime bundle grows about 2% (size-limit report), because the data type declarations now reach the runtime for parameter casts. Mongo is unchanged.

## What later slices do

Slice 2 (TML-3388) makes `contract.json` store `dataType` instead of `nativeType` and ships the upgrade script. Slice 3 (TML-3387) wires `resolveReportedSqlType`, which this slice defines and unit-tests, into introspection, verify and infer. Slice 4 (TML-3389) types written values outside defaults.

## Alternatives considered

- **Keep `nativeType` strings and normalise them on read.** Rejected in the design: it keeps eight sources and cannot recognise an extension's type.
- **A side registry of codecs for the planner** so SQLite need not register `sql/char@1` and `sql/varchar@1`. Rejected: a second source for which codecs a target has. The cost accepted instead is two aggregate rows in each SQLite `contract.d.ts`.
- **Writing the normalised parameters** (`numeric(10,0)` for `Numeric(10)`). Rejected: it would change migration SQL for existing columns.

Project files: `projects/data-types-completion/` (spec, design, plan, decision record, slice plan and in-loop review log).

Agent: thranduil-81
