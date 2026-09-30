# Research: data types and authoring entries (ADR 254) for `sql/expression`

Scope: the data type and authoring-entry layer, what must change to remove the lowering-entry kind, and what must change to add a family-named data type `sql/expression` that Postgres and SQLite register with the tag `sql`. Facts only, from the worktree at commit `6a5b58ecb7`. Paths are repo-relative.

## Key facts at a glance

- The lowering-entry kind lives in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:620-654`. It has five `src` consumers: `control-stack.ts` (two skips), `psl-column-resolution.ts` (lookup and dispatch), `data-type-default.ts` (filter), `default-mapping.ts` (filter), and the two adapters' `data-type-authoring.ts` (registration). Plus `sqlDefaultLiteralTagEntry` in the family, which builds the entries.
- Postgres and SQLite data types are declared in the target package but registered by the adapter descriptor, not by the target descriptor. Both the `DataType` list (`dataTypes`) and the authoring entries (`authoring.dataTypes`) come from the adapter.
- No assembly rule requires a data type to have a codec, an authoring entry, or to be a cast source. A type with no codec and no casts is valid. An authoring entry must be keyed by a registered data type id.
- `contract infer` for Postgres uses the target's `postgresDataTypeEntries()` only, not the adapter's entries, so it has no `sql` entry today. The `sql` printing for defaults is hard-coded in the family (`default-mapping.ts:75-78`).
- The only package that `contract-psl`, `contract-ts`, the family, both targets and both adapters all already depend on (besides framework packages) is `@internal/sql-contract` (`packages/2-sql/1-core/contract`). `@internal/family-sql` and `@internal/sql-relational-core` are not dependencies of `contract-psl` or `contract-ts`, and the family depends on both authoring packages.
- `pnpm lint:deps` (dependency-cruiser) does not see imports between workspace packages: `@internal/*` specifiers resolve to `dist/`, which the config excludes. Cross-package layering is held by the declared `package.json` dependencies and the absence of cycles.

## 1. Definitions and exports

### `DataTypeId`, `DataType`, `dataType()`, `DataTypeLookup`

File: `packages/1-framework/1-core/framework-components/src/shared/data-type.ts`. Exported from `src/exports/codec.ts:34-46` (`@internal/framework-components/codec`): types `Cast`, `DataType`, `DataTypeId`, `DataTypeLookup`, `DataTypeSpec`, `ListCast`; values `createDataTypeLookup`, `dataType`, `dataTypeId`.

```ts
// :23
export type DataTypeId = string & { readonly __dataTypeId: 'DataTypeId' };
// :29
export type Cast = (value: JsonValue) => JsonValue;
// :35
export interface ListCast {
  readonly of: readonly DataTypeId[];
  readonly cast: (elements: readonly JsonValue[]) => JsonValue;
}
// :40
export interface DataType {
  readonly id: DataTypeId;
  /** Keyed by the id of the type each cast takes values of. */
  readonly casts: Readonly<Record<DataTypeId, Cast>>;
  readonly listCast?: ListCast;
}
// :47
export interface DataTypeSpec {
  readonly casts?: Readonly<Record<string, Cast>>;
  readonly listCast?: { readonly of: readonly string[]; readonly cast: ListCast['cast'] };
}
// :53
export interface DataTypeLookup {
  get(id: string): DataType | undefined;
  has(id: string): boolean;
}
// :58
const DATA_TYPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
// :61
export function dataTypeId(id: string): DataTypeId  // throws CONTRACT.DATA_TYPE_ID_INVALID
// :73
export function dataType(id: string, spec: DataTypeSpec): DataType
// :88
export function createDataTypeLookup(types: readonly DataType[]): DataTypeLookup
```

`dataTypeId` error (`:63-67`): code `CONTRACT.DATA_TYPE_ID_INVALID`, message `` `"${id}" is not a data type id. A data type id is "owner/name" in lower case and carries no version, as in "owner/name"; a versioned id names a codec.` ``. The id `sql/expression` matches `DATA_TYPE_ID`.

`dataType()` validates its own id and every cast source through `dataTypeId` (`:73-86`). A `DataType` holds no written form, no codec and no print function; those are elsewhere.

`ComponentMetadata.dataTypes` (`packages/1-framework/1-core/framework-components/src/shared/framework-components.ts:65`): `readonly dataTypes?: ReadonlyArray<DataType>;` — any component (family, target, adapter, extension) may set it.

### `DataTypeWrittenForm`, `DataTypeAuthoringEntry`, `DataTypeLoweringAuthoringEntry`, `AuthoringDataTypeEntry`

File: `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`.

```ts
// :587-606
export type DataTypeWrittenForm =
  | {
      readonly kind: 'tag';
      readonly tag: string;
      readonly parse: (text: string) => JsonValue;
    }
  | {
      readonly kind: 'plain';
      readonly syntax: 'string' | 'boolean';
      readonly parse: (text: string) => JsonValue;
    }
  | {
      readonly kind: 'plain';
      readonly syntax: 'number';
      readonly types: readonly DataTypeId[];
      readonly classify: (
        text: string,
      ) => { readonly type: DataTypeId; readonly value: JsonValue } | undefined;
    };

// :613-618
export interface DataTypeAuthoringEntry {
  readonly written: DataTypeWrittenForm;
  readonly print: (value: JsonValue) => string;
  readonly documentation: string;
  readonly lower?: never;
}

// :624-631
export interface DataTypeLoweringAuthoringEntry {
  readonly written: { readonly kind: 'tag'; readonly tag: string };
  readonly documentation: string;
  readonly lower: (input: {
    readonly literal: TaggedLiteralValue;
    readonly context: DefaultFunctionLoweringContext;
  }) => LoweredDefaultResult;
}

// :633
export type AuthoringDataTypeEntry = DataTypeAuthoringEntry | DataTypeLoweringAuthoringEntry;

// :635
const LOWERING_ENTRY_PREFIX = 'lowering:';
// :641
export function loweringEntryKey(tag: string): string { return `${LOWERING_ENTRY_PREFIX}${tag}`; }
// :645
export function isLoweringEntryKey(key: string): boolean { return key.startsWith(LOWERING_ENTRY_PREFIX); }
// :650
export function isDataTypeLoweringEntry(
  entry: AuthoringDataTypeEntry,
): entry is DataTypeLoweringAuthoringEntry {
  return 'lower' in entry && entry.lower !== undefined;
}
```

`print` returns only the body; the caller adds the tag and the quotes (see §2.6). `DataTypeAuthoringEntry.lower?: never` exists only to make the union discriminable.

`AuthoringContributions.dataTypes` (`:682-686`), doc comment says "keyed by data type id, plus any lowering entries under their reserved keys":

```ts
readonly dataTypes?: Readonly<Record<string, AuthoringDataTypeEntry>>;
```

Imports that exist only for the lowering kind: `framework-authoring.ts:18-22` imports `DefaultFunctionLoweringContext`, `LoweredDefaultResult`, `TaggedLiteralValue` from `./mutation-default-types`. That file imports `AuthoringDataTypeEntry` back from `./framework-authoring` (`mutation-default-types.ts:6`), a type-only cycle that disappears with the lowering kind.

Exports from `src/exports/authoring.ts` (`@internal/framework-components/authoring`): types `AuthoringDataTypeEntry` (:7), `DataTypeAuthoringEntry` (:33), `DataTypeLoweringAuthoringEntry` (:34), `DataTypeWrittenForm` (:35); values `isDataTypeLoweringEntry` (:54), `isLoweringEntryKey` (:55), `loweringEntryKey` (:56).

### `TaggedLiteralValue`, `LoweredDefaultResult`, `DefaultFunctionLoweringContext`, `ControlDefaultRegistries`

File: `packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts`. All exported as types from `src/exports/control.ts:133-146` (`@internal/framework-components/control`).

```ts
// :27-32
export interface DefaultFunctionLoweringContext {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly columnCodecId?: string;
}
// :34-36
export type LoweredDefaultValue =
  | { readonly kind: 'storage'; readonly defaultValue: ColumnDefault }
  | { readonly kind: 'execution'; readonly generated: ExecutionMutationDefaultValue };
// :38-40
export type LoweredDefaultResult =
  | { readonly ok: true; readonly value: LoweredDefaultValue }
  | { readonly ok: false; readonly diagnostic: SourceDiagnostic };
// :86-90
/** A `` tag`body` `` default literal as the attribute spec accepted it: tag, canonical body, and span. */
export interface TaggedLiteralValue {
  readonly tag: string;
  readonly body: string;
  readonly span: SourceSpan;
}
// :101-104
export interface ControlDefaultRegistries
  extends Pick<ControlMutationDefaults, 'defaultFunctionRegistry'> {
  readonly dataTypeEntries: Readonly<Record<string, AuthoringDataTypeEntry>>;
}
```

`TaggedLiteralValue` is used only by `DataTypeLoweringAuthoringEntry.lower` (`framework-authoring.ts:628`) and its export (`exports/control.ts:144`). `DefaultFunctionLoweringContext` and `LoweredDefaultResult` are also used by `ControlMutationDefaultEntry.lower` (`:76-79`), so they stay.

`ControlDefaultRegistries` is the type of `AttributeSpecContext.controlMutationDefaults` (`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts:5-9`). Every model and field attribute spec factory therefore receives the stack's `dataTypeEntries`. Today only the `@default` factory reads them; `sqlAttributeSpecs.model.index` and `.check` are `() => indexModelSpec` / `() => checkModelSpec` and ignore the context (`packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts:700-709`).

## 2. Consumers of the lowering kind, its helpers, `knownTags` and `entryForTag`

### 2.1 Every `src` use

| File:line | Symbol | What it does |
| --- | --- | --- |
| `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:28` | `isLoweringEntryKey` import | — |
| `control-stack.ts:434` | `isLoweringEntryKey(key)` | Skips a lowering entry in rule 2 (entry key must be a registered type). |
| `control-stack.ts:451` | `isLoweringEntryKey(key)` | Excludes a lowering entry from the `writable` set used by rule 4. |
| `packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts:22-23` | imports `isDataTypeLoweringEntry`, `loweringEntryKey` | — |
| `psl-column-resolution.ts:735-736` | `support.entries[loweringEntryKey(literal.tag)] ?? entryForTag(support, literal.tag)?.entry` | Finds the entry for a `@default` tag: lowering key first, then a value entry by tag. |
| `psl-column-resolution.ts:740` | `knownTags(support)` | Lists tags in the `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` message. |
| `psl-column-resolution.ts:750-757` | `isDataTypeLoweringEntry(entry)` | Value entry: returns `{ ok: true, written: { kind: 'tag', tag, body } }`. Lowering entry: calls `entry.lower(...)`; a failure is tagged `kind: 'external'`. |
| `psl-column-resolution.ts:836-846` | (`'written' in lowered`) | A lowering tag inside a list literal is refused with `PSL_INVALID_DEFAULT_LITERAL`. |
| `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts:14` | `isDataTypeLoweringEntry` import | — |
| `data-type-default.ts:93-99` | `valueEntries` | Drops lowering entries; `entryForTag` and `entryForPlain` search only value entries. |
| `data-type-default.ts:102-110` | `entryForTag` | First value entry whose `written` is `{ kind: 'tag', tag }`. Exported via `@internal/sql-contract-psl/resolution`. |
| `data-type-default.ts:113-117` | `knownTags` | Every tag of every entry, both kinds, in merge order. Not exported from the package. |
| `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts:21,105` | `isDataTypeLoweringEntry` | `writingSurface` skips lowering entries. |
| `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts:14-45` | `sqlDefaultLiteralTagEntry(tag)` | Builds the lowering entry (§3.3). |
| `packages/3-targets/6-adapters/postgres/src/core/data-type-authoring.ts:9,15-16` | `loweringEntryKey('sql')`, `loweringEntryKey('pg.sql')` | Registers the two lowering entries. |
| `packages/3-targets/6-adapters/sqlite/src/core/data-type-authoring.ts:9,15-16` | `loweringEntryKey('sql')`, `loweringEntryKey('sqlite.sql')` | Same for SQLite. |

`entryForTag` is also used by the Prisma 7 reader (`packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts:20,293`, for the `json` tag only).

Consumers of the entries map that read `written.tag` of both kinds without calling the helpers:

- `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts:188-218` (`scalarDefaultArms`): builds one `taggedLiteral(tags, { documentation })` arm per distinct `documentation`. Both lowering entries share one documentation string, so today there is one arm `taggedLiteral(['sql', 'pg.sql'], …)` with label `` sql`...` ``. A list column gets `[listArm(), ...funcArms, ...tagArms()]`; a scalar column `[str(), numLiteral(), bool(), ...funcArms, ...tagArms(), listArm()]` (`:217-218`). List elements may be tagged literals (`:204`).
- `control-stack.ts:478-497` (rule 3 claim check) iterates all entries, both kinds.

Places that pass `dataTypeEntries` into an attribute spec context: `contract-psl/src/interpreter.ts:1157` (contributed model attributes), `psl-column-resolution.ts:787` (`@default`), `psl-field-resolution.ts:75` (enum `@default`), `language-server/src/attribute-spec-resolution.ts:69,88`, `packages/2-mongo-family/2-authoring/contract-psl/src/provider.ts:40`.

Where `DataTypeSupport.entries` is built from the stack: `contract-psl/src/interpreter.ts:2177-2180` (`input.authoringContributions?.dataTypes ?? {}` and `input.dataTypeLookup`), `contract-prisma7/src/interpreter.ts:1086-1089`.

### 2.2 Control-stack assembly (ADR 254 "Assembly")

Wiring: `createControlStack` (`control-stack.ts:803-864`) builds `allDescriptors = [family, target, adapter?, ...orderedExtensions]` (`:814`), calls `assembleAuthoringContributions` (`:817`, which calls `assembleAuthoringDataTypes` at `:322`), `assembleDataTypes` (`:819`), then `enforceDataTypeInvariants` (`:821-838`) with every descriptor's `types.codecTypes.codecDescriptors` (`codecId`, `dataType`) and every `authoring.dataTypes` entry (`key`, `entry`, `contributedBy`). `stack.dataTypeLookup` (`:853`) and `stack.authoringContributions.dataTypes` are the results.

| ADR 254 rule | Code | Error code | Message template |
| --- | --- | --- | --- |
| 3 (one owner per type id) | `assembleDataTypes`, `control-stack.ts:336-363` | `CONTRACT.DATA_TYPE_DUPLICATE` | `` `Duplicate data type "${type.id}". Component "${contributedBy}" conflicts with "${existingOwner}". ` + 'Each data type has exactly one owner across the composed stack.' `` |
| 3 (one entry per key) | `assembleAuthoringDataTypes`, `:366-389` | `CONTRACT.DATA_TYPE_ENTRY_DUPLICATE` | `` `Duplicate authoring entry for "${key}". Component "${contributedBy}" conflicts with "${existingOwner}".` `` |
| 1 (codec names a registered type) | `enforceDataTypeInvariants`, `:427-431` | `CONTRACT.DATA_TYPE_UNREGISTERED` | `` `${what} names data type "${id}", which no component registers. Contributed by "${contributedBy}".` `` with `what` = `` `Codec "${codec.codecId}"` `` |
| 2 (entry key is a registered type) | `:433-437`, skipped for lowering keys at `:434` | `CONTRACT.DATA_TYPE_UNREGISTERED` | same template, `what` = `'Authoring entry'` |
| 2 (classifier `types` registered) | `:438-444` | `CONTRACT.DATA_TYPE_UNREGISTERED` | same, `what` = `` `The classifier of authoring entry "${key}"` `` |
| 2 (cast source registered) | `:462-467` | `CONTRACT.DATA_TYPE_UNREGISTERED` | same, `what` = `` `The casts of data type "${type.id}"` `` |
| 4 (cast source writable) | `writable` set `:449-460` (lowering keys excluded at `:451`), check `:468-474` | `CONTRACT.DATA_TYPE_NOT_WRITABLE` | `` `Data type "${type.id}" casts from "${source}", which no contract source can write, so the cast is never exercised. Contributed by "${contributedBy}".` `` |
| 3 (one tag / one plain kind) | `:478-497`, all entries of both kinds | `CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE` | `` `Two authoring entries claim the ${claim}: "${key}" from "${contributedBy}" conflicts with "${existing.key}" from "${existing.contributedBy}".` `` where `claim` is `` `tag "${written.tag}"` `` or `` `plain ${written.syntax}` `` |

All use `runtimeError(code, message, details)` (`shared/runtime-error.ts:32`).

Differences between ADR 254's text and the code: ADR rule 1 also names "a type constructor"; the code checks only codec descriptors. The `writable` set (`:449-460`) is "every entry key plus every classifier `types` member".

### 2.3 PSL interpreter

See §6 for the full `@default` flow. The lowering kind touches `psl-column-resolution.ts:715-758` (`lowerTaggedLiteral`) and `:828-849` (`writtenElement`). `data-type-default.ts` touches it only through `valueEntries` and `knownTags`.

### 2.4 Language server

- `packages/1-framework/3-tooling/language-server/src/attribute-spec-resolution.ts:56-91`: builds the spec context with `dataTypeEntries: source.authoringContributions.dataTypes ?? {}` for model (`:69`) and field (`:88`) attributes.
- `language-server/src/completion-values.ts:135-145`: for an arg type of kind `'taggedLiteral'`, returns one completion per `type.tags` entry, text `` `${tag}\`$1\`` `` when snippets are supported, `detail: type.documentation`.
- `language-server/src/signature-help.ts:99-127`: uses `param.type.label`, which for a tagged-literal arm is `` `${tags[0] ?? 'tag'}\`...\`` `` (`psl-parser/src/attribute-spec/combinators/tagged-literal.ts:18`).
- `language-server/src/semantic-tokens.ts:452-454`: a `TaggedLiteralExprAst` returns no tokens.
- `language-server/src/config-resolution.ts:82-104`: the interpretation context carries `stack.authoringContributions` and `stack.dataTypeLookup`.

The language server has no direct reference to the lowering kind. Its tag list comes from the `@default` spec's arms, which come from `dataTypeEntries`.

### 2.5 `taggedLiteral` combinator

`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/tagged-literal.ts:12-33`. Signature: `taggedLiteral(tags: readonly string[], options: { readonly documentation: string }): TaggedLiteralArgType<AttributeCtx>`. Parsing accepts any tag; it returns `ParsedTaggedLiteral { tag: literal.tagName(), canonicalization: literal.canonicalization(), span }`. Types at `psl-parser/src/attribute-spec/types.ts:210-221`:

```ts
export interface ParsedTaggedLiteral {
  readonly tag: string;
  readonly canonicalization: TaggedLiteralCanonicalization;
  readonly span: PslSpan;
}
export interface TaggedLiteralArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<ParsedTaggedLiteral, Ctx> {
  readonly kind: 'taggedLiteral';
  readonly tags: readonly string[];
  readonly documentation: string;
}
```

`ArgTypeKind` (`types.ts:32-47`) has no data-type kind. There is no combinator that names a data type.

### 2.6 `contract infer` default printing

File: `packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts`, exported as `mapDefault` and `DefaultMappingOptions` from `@internal/family-sql/psl-infer` (`src/exports/psl-infer.ts:13,16`).

- `mapDefault` (`:52-69`): `literal` goes through `writeDefaultLiteral` and the entries; `function` prints `options.functionAttributes[expr] ?? DEFAULT_FUNCTION_ATTRIBUTES[expr] ?? `@default(${sqlLiteralText(expr)})``. `DEFAULT_FUNCTION_ATTRIBUTES` (`:26-29`) maps `'autoincrement()'` and `'now()'`.
- `sqlLiteralText` (`:75-78`) is the hard-coded `sql` printer; it does not use any entry:

```ts
function sqlLiteralText(expression: string): string {
  if (expression.includes('`')) return `sql"${escapePslString(expression)}"`;
  return `sql\`${expression.replace(/\\/g, '\\\\')}\``;
}
```

- `writingSurface` (`:98-122`) skips lowering entries (`:105`). A tag entry goes into `entryOf` and `tagTypes`; `classifications` (`:129-147`) adds `{ type, value }` for every tag type to every candidate list. `admitted` (`:150-163`) then requires the column type to be that type or to cast from it.
- `literalText` (`:194-201`) fences a tag entry's body as `` `${written.tag}\`${fenced}\`` `` where `fenced = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`')`. This differs from `sqlLiteralText`, which switches to the double-quote form when the body contains a backtick.
- `escapePslString` (`packages/2-sql/4-lanes/relational-core/src/ast/data-type-support.ts:60-66`) escapes `\`, `"`, newline, carriage return.

Callers: `packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts:390-408`. The mapping options come from `createPostgresDefaultMapping()` (`packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts:6-11`), which uses `postgresDataTypeEntries()` (target entries only, no `sql` entry) and `createDataTypeLookup(postgresDataTypes)`. Used by `infer-psl-contract.ts:221` and `junction-relation-field-names.ts:61`. SQLite has no PSL `contract infer`.

For orientation only (other printers that print raw SQL today as quoted strings): `postgres/src/core/psl-infer/infer-index-attributes.ts:41` (`expression`), `:60` (`where`), `:91` (check `expression`); `infer-policy-blocks.ts:113-121` (`using`, `withCheck` via `JSON.stringify`).

### 2.7 Prisma 7 reader (`contract-prisma7`)

- Imports `DataTypeSupport`, `DefaultRefusal`, `entryForTag`, `readDataTypeDefault`, `WrittenValue` from `@internal/sql-contract-psl/resolution` (`defaults.ts:17-23`).
- Builds `dataTypeSupport` from the stack (`interpreter.ts:1086-1089`).
- Never touches the lowering kind or the `sql` tag. Raw SQL arrives two ways and becomes `{ kind: 'function', expression }` directly, with no canonicalization and no `checkSqlDefaultBody`: `dbgenerated("…")` (`defaults.ts:397-418`) and a target's `sqlExpression` literal form (`defaults.ts:112-123`, `sqlExpressionDefault` at `:247-267`).
- `jsonDocumentOf` (`:290-309`) uses `entryForTag(input.dataTypeSupport, 'json')`.
- `refusalReason` (`:312-328`) words every `DefaultRefusal` kind (§7).

## 3. How Postgres and SQLite register data types today

### 3.1 The lists

- Postgres: `postgresDataTypes` at `packages/3-targets/3-targets/postgres/src/core/data-types.ts:120-146`, 25 types (`pg/text` … `pg/timestamptz`). Each is `dataType('pg/…', { casts })` (`:56-117`).
- Postgres entries: `postgresDataTypeEntries()` at `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:53-81`: `pg/text` (plain string), `pg/bool` (plain boolean), `pg/numeric` (plain number, `types: [pg/int2, pg/int4, pg/int8, pg/numeric]`), `pg/json` (tag `json`). Doc comment `:4-7` mentions `sql`/`pg.sql` sitting in the adapter.
- SQLite: `sqliteDataTypes` at `packages/3-targets/3-targets/sqlite/src/core/data-types.ts:73-81`, 7 types.
- SQLite entries: `sqliteDataTypeEntries()` at `packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts:38-61`: `sqlite/text` (plain string), `sqlite/real` (plain number, `types: [sqlite/integer, sqlite/bigint, sqlite/real]`), `sqlite/json` (tag `json`). No boolean entry.
- Both are exported through `@internal/target-postgres/data-types` and `@internal/target-sqlite/data-types` (`src/exports/data-types.ts`: `export * from '../core/data-type-entries'; export * from '../core/data-types';`).

### 3.2 Registration (the adapter, not the target)

| What | Postgres | SQLite |
| --- | --- | --- |
| `ComponentMetadata.dataTypes` | `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts:171` (`dataTypes: postgresDataTypes`) | `packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts:33` |
| `authoring.dataTypes` | `packages/3-targets/6-adapters/postgres/src/exports/control.ts:16-20` (`dataTypes: createPostgresDataTypeEntries()` at `:18`) | `packages/3-targets/6-adapters/sqlite/src/exports/control.ts:15-19` (`:17`) |
| Entries builder | `adapters/postgres/src/core/data-type-authoring.ts:12-18` | `adapters/sqlite/src/core/data-type-authoring.ts:12-18` |

```ts
// adapters/postgres/src/core/data-type-authoring.ts:12-18
export function createPostgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
  return {
    ...postgresDataTypeEntries(),
    [loweringEntryKey('sql')]: sqlDefaultLiteralTagEntry('sql'),
    [loweringEntryKey('pg.sql')]: sqlDefaultLiteralTagEntry('pg.sql'),
  };
}
```

The SQLite file is the same with `sqliteDataTypeEntries()` and `'sqlite.sql'`. Merge order gives tag order `json, sql, pg.sql` (Postgres) and `json, sql, sqlite.sql` (SQLite).

The target descriptors register neither: `packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts:22-32` (`authoring` has `type`, `field`, `entityTypes`, `pslBlockDescriptors`, `modelAttributes`, and target hooks, no `dataTypes`) and `packages/3-targets/3-targets/sqlite/src/core/descriptor-meta.ts:10-13`. The family descriptor (`packages/2-sql/9-family/src/core/control-descriptor.ts:18-24`) registers `field`, `type`, `entityTypes`, `pslBlockDescriptors`, `attributeSpecs`, and no data types. Extensions `pgvector` (`src/core/descriptor-meta.ts:73`) and `postgis` (`src/core/descriptor-meta.ts:149`) register `dataTypes` and no authoring entries.

### 3.3 The family's `sqlDefaultLiteralTagEntry`

`packages/2-sql/9-family/src/core/sql-default-literal-tag.ts` (whole file):

- `:7` `export const PSL_INVALID_DEFAULT_SQL: ContributedPslDiagnosticCode = 'PSL_INVALID_DEFAULT_SQL';`
- `:14` `export function sqlDefaultLiteralTagEntry(tag: string): AuthoringDataTypeEntry`
- `:16` `written: { kind: 'tag', tag }`
- `:17` `documentation: "Uses the SQL in the string, verbatim, as the column's default expression."`
- `:18-43` `lower`: `reservedSqlDefaultBody(literal.body)` → reject with `` `Write @default(${reserved}()) instead of ${literal.tag}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.` ``; `checkSqlDefaultBody(literal.body)` → reject with its reason; otherwise `{ ok: true, value: { kind: 'storage', defaultValue: { kind: 'function', expression: literal.body } } }`. A rejection is `{ ok: false, diagnostic: { code: PSL_INVALID_DEFAULT_SQL, message, sourceId: context.sourceId, span: literal.span } }`.

Exported from `packages/2-sql/9-family/src/exports/control.ts:94-97` (`PSL_INVALID_DEFAULT_SQL`, `sqlDefaultLiteralTagEntry`), with `checkSqlDefaultBody` re-exported at `:15`. Importers: both adapters' `data-type-authoring.ts:7`, and the family test.

### 3.4 Does a data type need a codec? Is anything required of a type that is never a cast source?

No on both counts. Assembly checks only these directions (§2.2):

- codec → type must exist (`control-stack.ts:427-431`);
- entry key → type must exist (`:433-437`);
- cast source → type must exist and must be writable (`:462-475`).

```ts
// control-stack.ts:462-475
for (const { type, contributedBy } of input.declaredTypes) {
  const sources = [...Object.keys(type.casts), ...(type.listCast?.of ?? [])];
  for (const source of sources) {
    if (!input.lookup.has(source)) {
      unregistered(contributedBy, source, `The casts of data type "${type.id}"`);
    }
    if (!writable.has(source)) {
      throw runtimeError(
        'CONTRACT.DATA_TYPE_NOT_WRITABLE',
        …
```

Nothing iterates declared types to demand a codec or an entry. ADR 254 says so too: "The reverse of the last is not required: a type may be reachable only through casts." A `sql/expression` type with no casts, no codec and one tag entry passes every rule, provided its `DataType` is registered in the same stack as its entry. A second component registering the same id fails `CONTRACT.DATA_TYPE_DUPLICATE`; a second entry claiming tag `sql` fails `CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE` (this includes a leftover lowering entry with tag `sql`).

The inventory tests go codec → type only (`packages/3-targets/3-targets/postgres/test/data-type-inventory.test.ts`, `sqlite/test/data-type-inventory.test.ts`). The list tests `postgres/test/data-types.test.ts:35-61` and `sqlite/test/data-types.test.ts:17-26` assert the exact sorted id list of `postgresDataTypes` / `sqliteDataTypes`, so adding an id to those arrays changes them.

`readDataTypeDefault` reaches a column's data type only through its codec descriptor (`data-type-default.ts:272-284`). A type without a codec can never be a column's type, so a `sql/expression` value can reach a column only through a cast, and no type casts from it.

## 4. Where the family could export `sql/expression`, and who can import what

### 4.1 Existing precedents for family-named ids that targets fill in

- Codec ids `SQL_CHAR_CODEC_ID`, `SQL_VARCHAR_CODEC_ID`, `SQL_INT_CODEC_ID`, `SQL_FLOAT_CODEC_ID`, `SQL_TEXT_CODEC_ID` (`'sql/int@1'` etc.) at `packages/2-sql/4-lanes/relational-core/src/ast/sql-codec-helpers.ts:10-14`, exported from `@internal/sql-relational-core/ast` (`src/exports/ast.ts` re-exports `../ast/sql-codec-helpers`). Shared codec templates (`sqlIntDescriptor` etc.) at `relational-core/src/ast/sql-codecs.ts:83,121`.
- Each target fills in the data type: `postgresCodec(sqlIntDescriptor, { dataType: pgInt4.id, nativeType: () => 'int4', … })` at `packages/3-targets/3-targets/postgres/src/core/codecs.ts:335-339` (similar for `sql/char`, `sql/varchar`, `sql/float`, `sql/text` at `:323-351`). `postgresCodec` signature: `postgresCodec<D extends AnyCodecDescriptorTemplate>(descriptor: D, options: PostgresCodecOptions<DescriptorParams<D>>): AdaptedPostgresCodecDescriptor<D>` (`postgres/src/core/codec-descriptor.ts:196-204`). Targets re-export the ids: `postgres/src/core/codec-ids.ts:1-7`, `sqlite/src/exports/codec-ids.ts:1-14`.
- Shared data-type helpers: `packages/2-sql/4-lanes/relational-core/src/ast/data-type-support.ts` (`isNumeralText`, `isNonFiniteText`, `canonicalNumeralText`, `numeralText`, `escapePslString`, `NumberClassification`, `IntegerStep`, `signedRange`, `NumberClassifierSpec`, `createNumberClassifier`, `parseJsonBody`, `printJsonBody`), exported from `@internal/sql-relational-core/ast`. Its header (`:4-7`) says "The family registers no data types of its own".
- Default SQL checks: `checkSqlDefaultBody`, `reservedSqlDefaultBody` at `packages/2-sql/1-core/contract/src/default-sql-body.ts`, exported from `@internal/sql-contract/validators` (`src/exports/validators.ts:1`). Imported by the family (`sql-default-literal-tag.ts:4`), `contract-ts` (`sql-default-literal.ts:7`), and the `contract-psl` test fixture. The family re-exports `checkSqlDefaultBody` (`family-sql/src/exports/control.ts:15`), which both targets' planners import (`postgres/src/core/migrations/planner-ddl-builders.ts:2`, `sqlite/…:11`).
- The family's `sql` lowering entry: `@internal/family-sql/control` (§3.3).

### 4.2 Package names and declared `@internal` dependencies

| Package (path) | Name | `@internal` dependencies relevant here |
| --- | --- | --- |
| `packages/2-sql/1-core/contract` | `@internal/sql-contract` | `contract`, `framework-components`, `sql-schema-ir`, `utils` |
| `packages/2-sql/2-authoring/contract-ts` | `@internal/sql-contract-ts` | `config`, `contract`, `contract-authoring`, `framework-components`, `sql-contract`, `sql-schema-ir`, `utils` |
| `packages/2-sql/2-authoring/contract-psl` | `@internal/sql-contract-psl` | `config`, `contract`, `contract-authoring`, `framework-components`, `psl-parser`, `sql-contract`, `sql-contract-ts`, `utils` |
| `packages/2-sql/2-authoring/contract-prisma7` | `@internal/sql-contract-prisma7` | … `framework-components`, `psl-parser`, `sql-contract`, `sql-contract-psl`, `sql-contract-ts` |
| `packages/2-sql/4-lanes/relational-core` | `@internal/sql-relational-core` | `contract`, `framework-components`, `operations`, `sql-contract`, `sql-operations`, `utils` |
| `packages/2-sql/9-family` | `@internal/family-sql` | … `framework-components`, `psl-parser`, `sql-contract`, `sql-contract-emitter`, `sql-contract-psl`, `sql-contract-ts`, `sql-operations`, `sql-relational-core`, `sql-runtime`, `sql-schema-ir` |
| `packages/3-targets/3-targets/postgres` | `@internal/target-postgres` | … `family-sql`, `framework-components`, `psl-parser`, `sql-contract`, `sql-relational-core`, … (no `sql-contract-psl`, no `sql-contract-ts`) |
| `packages/3-targets/3-targets/sqlite` | `@internal/target-sqlite` | … `family-sql`, `framework-components`, `sql-contract`, `sql-relational-core`, `sql-runtime`, … (no `psl-parser`, no `sql-contract-psl`, no `sql-contract-ts`) |
| `packages/3-targets/6-adapters/postgres` | `@internal/adapter-postgres` | … `family-sql`, `framework-components`, `psl-parser`, `sql-contract`, `sql-contract-psl`, `sql-contract-ts`, `sql-relational-core`, `target-postgres`, … |
| `packages/3-targets/6-adapters/sqlite` | `@internal/adapter-sqlite` | same shape with `target-sqlite` |
| `packages/1-framework/3-tooling/language-server` | `@internal/language-server` | `config`, `config-loader`, `errors`, `framework-components`, `psl-parser`, `utils` |

Entry points: `@internal/sql-contract` exports `./validators`, `./types`, `./factories`, and others (no `data-types` entry today). `@internal/family-sql` exports `./control`, `./control-adapter`, `./diff`, `./ir`, `./migration`, `./pack`, `./psl-infer`, `./runtime`, `./verify`. `@internal/sql-relational-core` exports `./ast` among others.

### 4.3 Layering rules

`architecture.config.json`:

- Domain/layer/plane of the packages above: `packages/2-sql/1-core/**` sql/core/shared (`:160-164`); `packages/2-sql/2-authoring/**` sql/authoring/migration (`:172-176`); `packages/2-sql/4-lanes/**` sql/lanes/runtime (`:208-212`); `packages/2-sql/9-family/src/core/**` sql/family/shared (`:184-188`); `9-family/src/exports/control.ts` sql/family/migration (`:190-194`); `packages/3-targets/3-targets/postgres/src/exports/control.ts` extensions/targets/migration (`:232-236`) — Postgres target `src/core/**` has no mapping; `packages/3-targets/3-targets/sqlite/src/core/**` extensions/targets/shared (`:424-428`); `packages/3-targets/6-adapters/postgres/src/core/**` and `…/sqlite/src/core/**` targets/adapters/shared (`:244-248`, `:448-452`); `packages/1-framework/3-tooling/language-server/**` framework/tooling.
- `rules` (`:742-749`): same layer allowed, downward allowed, upward denied, cross-domain directional.
- `layerOrder.sql`: `["core", "authoring", "tooling", "lanes", "runtime", "adapters", "drivers", "family"]`. So `authoring` may import `core`; it may not import `lanes` or `family`.
- `crossDomainRules`: framework imports nothing; sql imports framework; targets imports framework, sql, mongo; extensions imports anything.
- `planeRules`: shared imports only shared; migration imports shared and migration; runtime imports shared and runtime.

How the rules are enforced in practice: `dependency-cruiser.config.mjs` resolves with `exportsFields: ['exports']` and excludes `dist` (`:329-345`). Every `@internal/*` package's `exports` points at `./dist/*.mjs`, so cross-package edges drop out of the graph. Checked by running `pnpm exec depcruise --config dependency-cruiser.config.mjs packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts --output-type json`: the module reports zero dependencies, although it imports five `@internal/*` packages, including `@internal/sql-relational-core/ast` (sql/lanes/runtime) from sql/family/shared, which the plane rule would forbid. So the depcruise rules bind relative imports inside a package. Between packages, what holds is: a package imports only what its `package.json` declares, and the workspace graph has no cycles (the family depends on `sql-contract-psl` and `sql-contract-ts`, so neither can depend on the family).

`scripts/lint-framework-target-imports.mjs` additionally fails on any `@internal/target-` text under `packages/1-framework`.

### 4.4 What each named package can import today

| Candidate home | target-postgres | adapter-postgres | family-sql (control) | contract-psl | contract-ts |
| --- | --- | --- | --- | --- | --- |
| `@internal/framework-components/*` | yes | yes | yes | yes | yes |
| `@internal/sql-contract/*` (1-core) | yes (declared) | yes | yes | yes | yes |
| `@internal/sql-relational-core/*` (4-lanes) | yes | yes | yes | not declared; lanes is above authoring in `layerOrder` | not declared; same |
| `@internal/family-sql/*` (9-family) | yes | yes | — | no: the family depends on contract-psl (cycle); family is last in `layerOrder` | no: same |
| `@internal/sql-contract-psl/*` | not declared | yes | yes | — | no: contract-psl depends on contract-ts (cycle) |
| `@internal/sql-contract-ts/*` | not declared | yes | yes | yes | — |
| `@internal/target-*` | — | yes (own target) | no (target depends on family) | no | no |

`@internal/sql-contract` already imports from `@internal/framework-components/control` (`src/types.ts:2`, type-only) and depends on `framework-components`, so `canonicalizeTaggedLiteralBody` and `dataType` are reachable from it. The `contract-psl` test fixture `test/fixture-sql-tag.ts:1-4` states that the authoring layer's tests cannot import the family, which is why it mirrors `sqlDefaultLiteralTagEntry`.

ADR text that names the current rule: `docs/architecture docs/adrs/ADR 254 - Data types and casts.md:77` ("No type spans targets, and no family registers types. The SQL family exports implementations targets share …"); `:143` (the lowering-entry paragraph); `:225` ("`sql` is the one lowering tag"). ADR 129 `:78-80` (unprefixed `sql` registered by each target; each target also registers a prefixed alias).

## 5. Tagged-literal canonicalization and escape resolvers

File: `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts`. All exported from `src/exports/control.ts:147-154` (`@internal/framework-components/control`): type `TaggedLiteralCanonicalization`; values `canonicalizeTaggedLiteralBody`, `describeTaggedLiteralFailure`, `resolvePslBacktickEscapes`, `resolveTemplateTagEscapes`, `TAGGED_LITERAL_MAX_BYTES`.

```ts
// :5-11
export type TaggedLiteralCanonicalization =
  | { readonly ok: true; readonly body: string }
  | {
      readonly ok: false;
      readonly reason: 'nul' | 'too-large';
      readonly offset: number;
    };
// :13
export const TAGGED_LITERAL_MAX_BYTES = 65536;
// :16
export function describeTaggedLiteralFailure(reason: 'nul' | 'too-large'): string
//   'nul'       → 'Tagged literals must not contain NUL characters.'
//   'too-large' → `Tagged literal exceeds ${TAGGED_LITERAL_MAX_BYTES} bytes.`
// :29
export function resolvePslBacktickEscapes(raw: string): string   // resolves \` and \\ only
// :34
export function resolveTemplateTagEscapes(raw: string): string   // resolves \` \\ and \$
// :73
export function canonicalizeTaggedLiteralBody(resolved: string): TaggedLiteralCanonicalization
```

Every other backslash sequence is kept as both characters (`:38-54`).

`canonicalizeTaggedLiteralBody` steps (`:73-96`): NUL anywhere → `{ ok: false, reason: 'nul', offset: indexOf('\0') }`; split on `\r\n|\r|\n`; drop a first line that is blank (`/^[ \t]*$/`); drop a last line that is blank; remove the common leading indent of the non-blank lines (spaces and tabs); make blank inner lines empty; if the UTF-8 size (newlines count one byte) exceeds 65536 → `{ ok: false, reason: 'too-large', offset }` where `offset` is the resolved-text index of the first character past the limit; otherwise `{ ok: true, body: lines.join('\n') }`. Trailing whitespace on non-blank lines is kept. For a one-line body the common indent is that line's own leading whitespace, so leading spaces and tabs are removed.

Callers:

- PSL: `StringLiteralExprAst.value()` (`packages/1-framework/2-authoring/psl-parser/src/syntax/ast/expressions.ts:179-184`) resolves a backtick string with `resolvePslBacktickEscapes` and a `"`/`'` string with the parser's own `decodeStringLiteral` (`:90-…`). `TaggedLiteralExprAst.canonicalization()` (`:217-219`) is `canonicalizeTaggedLiteralBody(this.literal()?.value() ?? '')`; `body()` (`:222-225`) returns the body or `undefined`. `tagName()` (`:204-211`) joins `space:`, `namespace.` and identifier.
- TypeScript: `sql` tag (`packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts:16-49`): `canonicalizeTaggedLiteralBody(resolveTemplateTagEscapes(strings.raw.join('')))`.
- `describeTaggedLiteralFailure` is also used at `psl-column-resolution.ts:747`.

## 6. `@default` lowering of a tagged literal today

1. Parse. `parseTaggedLiteral` (`packages/1-framework/2-authoring/psl-parser/src/parse.ts:297-303`) makes a `TaggedLiteral` node: a bare or one-dot qualified name, then a string (`isTaggedLiteralAhead`, `:286-293`). Any tag parses, including `pg.sql`.
2. Spec. `defaultFieldSpec(ctx)` (`contract-psl/src/sql-attribute-specs.ts:280-297`) picks `scalarDefaultArms(ctx.field.list, ctx.controlMutationDefaults)` (`:188-218`) or, for an enum-typed field, `enumDefaultArms` (identifiers only, so no tagged literal on enum fields). The arms are wrapped by `defaultValueArm` (`:226-248`), which refuses `dbgenerated(...)` with `PSL_UNKNOWN_DEFAULT_FUNCTION`.
3. Argument parse. The `taggedLiteral` arm (`combinators/tagged-literal.ts:21-31`) returns `ParsedTaggedLiteral { tag, canonicalization, span }`. The canonicalization is not checked here.
4. Interpret. `lowerDefaultForField` (`contract-psl/src/psl-column-resolution.ts:760-932`) builds the spec with `dataTypeEntries: input.dataTypeSupport.entries` (`:781-790`), calls `interpretFieldAttribute` (`:791-799`), builds `DefaultFunctionLoweringContext { sourceId, modelName, fieldName, columnCodecId }` (`:801-806`). For a scalar value with `'tag' in value` it calls `lowerTaggedLiteral` (`:880-889`). Caller: `psl-field-resolution.ts:586-599`.
5. `lowerTaggedLiteral` (`:720-758`):
   - entry = `support.entries[loweringEntryKey(literal.tag)] ?? entryForTag(support, literal.tag)?.entry` (`:735-736`);
   - no entry → `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, `` `Unknown literal tag "${literal.tag}". Known tags: ${knownTags(support).join(', ')}.` `` at the literal span (`:737-742`);
   - canonicalization failed → `PSL_TAGGED_LITERAL_NUL` or `PSL_TAGGED_LITERAL_TOO_LARGE` (map at `:710-713`), message `describeTaggedLiteralFailure(reason)`, at the literal span (`:743-749`);
   - value entry → `{ ok: true, written: { kind: 'tag', tag: literal.tag, body } }` (`:750-752`);
   - lowering entry → `entry.lower({ literal: { tag, body, span }, context })`; failure becomes `{ ...result, kind: 'external' }` (`:753-757`).
   All three refusals above are `kind: 'owned'` (`:726-734`).
6. Family lowering entry `sqlDefaultLiteralTagEntry(tag).lower` (`9-family/src/core/sql-default-literal-tag.ts:18-43`): `reservedSqlDefaultBody` → `PSL_INVALID_DEFAULT_SQL`; `checkSqlDefaultBody` → `PSL_INVALID_DEFAULT_SQL`; success → `{ ok: true, value: { kind: 'storage', defaultValue: { kind: 'function', expression: literal.body } } }`.
7. Back in `lowerDefaultForField` (`:891-900`): a failure is pushed with `diagnostics.push` (owned) or `diagnostics.pushExternal` (external); `'written' in lowered` → `readAsLiteral` (`:808-826`, §7); `lowered.value.kind === 'storage'` → returns `{ defaultValue: lowered.value.defaultValue }`, the stored `{ kind: 'function', expression }`.
8. Lists. `writtenElement` (`:828-849`) calls `lowerTaggedLiteral` on each tagged element; a lowering entry's result (no `written`) is refused with `PSL_INVALID_DEFAULT_LITERAL`, `` `Literal tag "${element.tag}" produces a default of its own and cannot be an element of a list literal.` `` at the element span. On a list column the top-level arms include the tag arms (`sql-attribute-specs.ts:217`), so `` tags String[] @default(sql`'{}'::text[]`) `` is accepted as a whole-column function default (parity fixture `test/integration/test/authoring/parity/default-sql-literal/schema.prisma:8`).

Consequence of the current flow, stated as fact: with no lowering entry, a `sql` tag entry keyed by a data type id takes the value-entry branch (`:750-752`) and then `readAsLiteral`, where `castInto` refuses it as `no-cast` unless the column type is that type or casts from it (`data-type-default.ts:211-231`).

### Refusal codes

| Code | Declared | Message |
| --- | --- | --- |
| `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `packages/1-framework/1-core/framework-components/src/shared/psl-extension-block.ts:84` (member of `PslDiagnosticCode`, doc "A `@default` tagged literal whose tag no pack in the stack registered.") | `` `Unknown literal tag "${tag}". Known tags: ${known.join(', ')}.` `` — written as a string literal at `psl-column-resolution.ts:739-740` and `data-type-default.ts:447-448` |
| `PSL_TAGGED_LITERAL_NUL` | `psl-extension-block.ts:86` | `'Tagged literals must not contain NUL characters.'` |
| `PSL_TAGGED_LITERAL_TOO_LARGE` | `psl-extension-block.ts:88` | `` `Tagged literal exceeds ${TAGGED_LITERAL_MAX_BYTES} bytes.` `` |
| `PSL_INVALID_DEFAULT_SQL` | `9-family/src/core/sql-default-literal-tag.ts:7` (a `ContributedPslDiagnosticCode`, i.e. `` `PSL_${string}` ``, `psl-extension-block.ts:140`) | reserved: `` `Write @default(${reserved}()) instead of ${literal.tag}\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.` ``; unsafe: `checkSqlDefaultBody`'s text |

### `checkSqlDefaultBody` and `reservedSqlDefaultBody`

`packages/2-sql/1-core/contract/src/default-sql-body.ts` (whole file):

```ts
const UNSAFE_DEFAULT_BODY = /;|--|\/\*|\$\$|\bSELECT\b/i;

/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined {
  return UNSAFE_DEFAULT_BODY.test(body)
    ? 'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.'
    : undefined;
}

export function reservedSqlDefaultBody(body: string): 'now' | 'autoincrement' | undefined {
  switch (body.trim()) {
    case 'now()':
      return 'now';
    case 'autoincrement()':
      return 'autoincrement';
    default:
      return undefined;
  }
}
```

Exported from `@internal/sql-contract/validators` (`src/exports/validators.ts:1`); `checkSqlDefaultBody` also re-exported from `@internal/family-sql/control` (`9-family/src/exports/control.ts:15`).

Callers (src):

- `9-family/src/core/sql-default-literal-tag.ts:28,34` (PSL `@default`).
- `contract-ts/src/sql-default-literal.ts:34-47` (TypeScript `sql` tag): reserved → `CONTRACT.DEFAULT_INVALID`, `` `Write .default(${reserved}()) instead of sql\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.` ``, `meta: { reason: 'reserved-function', expression }`; unsafe → `CONTRACT.DEFAULT_INVALID`, the check's text, `meta: { reason: 'unsafe-sql', expression }`. Canonicalization failure → `CONTRACT.DEFAULT_INVALID`, `describeTaggedLiteralFailure(reason)`, `meta: { reason, offset }`. Interpolation → `CONTRACT.DEFAULT_SQL_INTERPOLATION`, `'sql`...` does not support interpolation; write the SQL as one literal.'`. Returns `ColumnDefault` `{ kind: 'function', expression: canonical.body }`. Re-exported from `@internal/sql-contract-ts/contract-builder` (`src/exports/contract-builder.ts:55`), `packages/3-extensions/postgres/src/exports/contract-builder.ts:27`, `packages/3-extensions/sqlite/src/exports/contract-builder.ts:22`.
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts:34-43` and `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts:35-44` (`assertSafeDefaultExpression`): `CONTRACT.DEFAULT_INVALID`, `` `Unsafe default expression in contract: "${expression}". ` + 'Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.' `` (via `postgresError` / `sqliteError`).
- Test-only: `contract-psl/test/fixture-sql-tag.ts:7,23,29`.

## 7. `readDataTypeDefault` (`packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts`)

Exported from `@internal/sql-contract-psl/resolution` (`src/exports/resolution.ts:1-9`) together with `DataTypeSupport`, `DefaultColumn`, `DefaultRefusal`, `entryForTag`, `ReadDefaultResult`, `WrittenValue`. `knownTags`, `lowerDataTypeDefault` and the diagnostic constants are internal to the package.

```ts
// :38-43
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly body: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };
// :46-49
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, AuthoringDataTypeEntry>>;
  readonly lookup: DataTypeLookup;
}
// :67-82
export type DefaultRefusal = {
  readonly elementIndex: number | undefined;
} & (
  | { readonly kind: 'unreadable'; readonly json: boolean; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: string }
  | { readonly kind: 'not-a-list' }
  | {
      readonly kind: 'no-cast';
      readonly columnType: string;
      readonly valueType: string;
      readonly casts: readonly string[];
    }
  | { readonly kind: 'undecodable'; readonly codecId: string; readonly message: string }
);
// :264-271
export function readDataTypeDefault(input: {
  readonly written: WrittenValue;
  readonly isList: boolean;
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookup | undefined;
  readonly support: DataTypeSupport;
  readonly fieldPath: string;
}): ReadDefaultResult
```

Flow: the column's data type is `codecLookup.descriptorFor(codecId).dataType` (`:272-284`, an `InternalError` if either is missing); the codec is materialized with the column's `typeParams` (`:286-293`). For each value: `readValue` (`:152-208`) finds the entry by syntax (`entryForTag` or `entryForPlain`, value entries only) → `unknown-tag` or `unwritable`; a number goes through `classify` (`unreadable`, message `` `no data type of this target holds the number ${text}` ``); otherwise `parse` (`unreadable`, with `json` true when the thrown error code is `CONTRACT.INVALID_JSON_LITERAL`). Then `castInto` (`:211-245`) → `no-cast` or `unreadable`. Then the codec's `decodeJson` → `undecodable` (`:294-309`). A list value on a list column reads each element (`:329-348`); a nested list is `unreadable` `'a list holds values, not other lists'`. A non-list value on a list column is `not-a-list` (`:322-325`). A list on a scalar column goes through `readListIntoScalar` (`:354-417`) and the type's `listCast`.

PSL wording: `lowerDataTypeDefault` (`:425-475`). `where` = `` `Field "${fieldPath}"${at(elementIndex)}` ``, `at` = `` ` at element ${i + 1}` `` or empty (`:420-422`).

| Refusal kind | Code | Message |
| --- | --- | --- |
| `unreadable` | `PSL_INVALID_JSON_LITERAL` if `json`, else `PSL_INVALID_DEFAULT_LITERAL` | `` `${where}: ${refusal.message}` `` |
| `unknown-tag` | `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` | `` `Unknown literal tag "${refusal.tag}". Known tags: ${refusal.known.join(', ')}.` `` |
| `unwritable` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: this target has no data type for a ${refusal.syntax} value` `` |
| `not-a-list` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: this column holds a list, so its default is a list literal, as in [1, 2]` `` |
| `no-cast` | `PSL_DEFAULT_TYPE_INCOMPATIBLE` | `` `${where}: ${refusal.columnType} has no cast from ${refusal.valueType}; ${describeCasts(refusal.casts)}` ``, `describeCasts` = `'it casts from nothing'` or `` `it casts from ${casts.join(', ')}` `` (`:477-479`) |
| `undecodable` | `PSL_INVALID_DEFAULT_LITERAL` | `` `${where}: ${refusal.message}` `` |

Constants: `PSL_INVALID_JSON_LITERAL` (`:24`), `PSL_INVALID_DEFAULT_LITERAL` (`:27-28`), `PSL_DEFAULT_TYPE_INCOMPATIBLE` (`:31-32`), all `ContributedPslDiagnosticCode`. The PSL diagnostic is pushed at `psl-column-resolution.ts:817-821` with `...source.at()`, whose span is the whole `@default` attribute node (`psl-parser/src/diagnostic.ts:25-35`, no span → the node's range). In the PSL path an unknown tag is caught earlier by `lowerTaggedLiteral`, so the `unknown-tag` refusal is reached only through the Prisma 7 reader.

Prisma 7 wording (`contract-prisma7/src/defaults.ts:312-328`), code `PSL.PRISMA7_UNKNOWN_DEFAULT`, message `` `${label}: @default ${reason}` `` with `reason` per kind: `unreadable` `` `holds text${at} that this contract source does not read: ${message}` ``; `unknown-tag` `` `holds a ${tag} literal${at}, which this stack does not register.` ``; `unwritable` `` `holds a ${syntax} value${at}, which this target has no data type for.` ``; `not-a-list` `'holds a single value on a list column, which takes a list literal.'`; `no-cast` `` `holds a ${valueType} value${at}, which ${columnType} has no cast from; …` ``; `undecodable` `` `holds a value${at} that ${codecId} does not read: ${message}` ``.

## 8. Tests that assert on lowering entries, `pg.sql`, `sqlite.sql`, or the known tags

Lowering-entry kind and helpers:

- `packages/1-framework/1-core/framework-components/test/data-type-assembly.test.ts` — `assembleAuthoringDataTypes` merges a `lowering:sql` key (`:164-181`); `loweringEntryKey` is never a data type id (`:193-197`).
- `packages/2-sql/9-family/test/sql-default-literal-tag.test.ts` — `checkSqlDefaultBody` cases; `sqlDefaultLiteralTagEntry('pg.sql')` shape, lowering and refusals including `sql`, `pg.sql`, `sqlite.sql`; the contract-psl fixture mirrors the family entry.
- `packages/2-sql/2-authoring/contract-psl/test/fixture-sql-tag.ts` — test mirror of the family lowering entry (`sqlLiteralTagLowering`).
- `packages/2-sql/2-authoring/contract-psl/test/fixture-data-types.ts` — fixture stack entries, registers `lowering:sql` and `lowering:pg.sql` (`:172-173`); imported by about 40 interpreter tests.
- `packages/3-targets/6-adapters/postgres/test/data-type-authoring.test.ts` — exact key list including `lowering:pg.sql`, `lowering:sql` (`:28-37`); lowering of `sql` and `pg.sql` (`:59-67`).
- `packages/3-targets/6-adapters/sqlite/test/data-type-authoring.test.ts` — same for `lowering:sql`, `lowering:sqlite.sql`.
- `packages/3-targets/6-adapters/postgres/test/control-mutation-defaults.test.ts` — `createPostgresDataTypeEntries` (`:328-…`): tags equal `['json', 'sql', 'pg.sql']`, `pg.sql` lowering, wiring into the adapter descriptor, `now`/`autoincrement` refusals naming the tag.
- `packages/3-targets/6-adapters/sqlite/test/control-mutation-defaults.test.ts` — same with `['json', 'sql', 'sqlite.sql']`.

Known tags and `pg.sql` / `sqlite.sql` in PSL and tooling:

- `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.tagged-literal.test.ts` — `pg.sql` default lowers (`:80`, `:193`); unknown `sqlite.sql` message `'Unknown literal tag "sqlite.sql". Known tags: json, sql, pg.sql.'` (`:139-146`); arm list in the syntax error (`:126-136`); lowering tag inside a list refused (`:255-265`); NUL, too-large, SQL-check refusals.
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.data-types.test.ts` — `sqlite.sql` refused as unknown on a Postgres-like stack (`:237-241`).
- `packages/2-sql/2-authoring/contract-psl/test/sql-attribute-specs.test.ts` — `@default` tagged arms `tags: ['sql', 'pg.sql']`, label `` sql`...` ``, documentation (`:340-351`).
- `packages/1-framework/3-tooling/language-server/test/completion-provider.test.ts` — `@default` completions list `json`, `sql`, `pg.sql` (Postgres) and `json`, `sql`, `sqlite.sql` (SQLite) (`:1186-1262`).
- `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-combinators.tagged-literal.test.ts` — combinator with tags `['sql', 'pg.sql']`, parses `pg.sql` and `sqlite.sql` literals (syntax level; the combinator accepts any tag).
- `packages/1-framework/2-authoring/psl-parser/test/parse-tagged-literal.test.ts` — parses `` pg.sql`now()` `` and `pg.sql"y"` (syntax level).
- `packages/1-framework/2-authoring/psl-parser/test/tokenizer.test.ts:355` — lossless tokenizing of `` pg.sql `a` `` (syntax level).
- `packages/1-framework/2-authoring/psl-parser/test/format/fixtures/tagged-literal/input.prisma` and `expected.prisma` — formatter fixture with `` @default(pg.sql`now()`) `` (syntax level).
- `test/integration/test/authoring/parity/default-sql-literal/schema.prisma:7` — parity fixture uses `` pg.sql`(now() + interval '1 hour')` ``; siblings `contract.ts`, `expected.contract.json`, `packs.ts`.

Related, not asserting on the lowering kind:

- `packages/1-framework/1-core/framework-components/test/tagged-literal.test.ts` — canonicalization and escape resolvers.
- `packages/2-sql/2-authoring/contract-ts/test/sql-default-literal.test.ts`, `sql-default-literal.test-d.ts` — TypeScript `sql` tag.
- `packages/3-targets/3-targets/postgres/test/data-types.test.ts:35-61`, `packages/3-targets/3-targets/sqlite/test/data-types.test.ts:17-26` — exact id lists of `postgresDataTypes` / `sqliteDataTypes`.
- `packages/1-framework/3-tooling/language-server/test/attribute-spec-consumability.test.ts:198,232` and `test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts:52,104,174` — pass `authoringContributions.dataTypes` through as `dataTypeEntries`.

## 9. Non-test text that names the lowering kind or the prefixed tags

Code comments: `framework-authoring.ts:620-623,637-640,683-685`; `sql-default-literal-tag.ts:9-13`; both adapters' `data-type-authoring.ts:1-5`; `postgres/src/core/data-type-entries.ts:4-7`; `psl-column-resolution.ts:715`; `psl-parser/src/syntax/ast/expressions.ts:203` (`` e.g. `pg.sql` ``); `relational-core/src/ast/data-type-support.ts:4-7` ("The family registers no data types of its own").

Docs: `docs/architecture docs/adrs/ADR 254 - Data types and casts.md:77,143,225`; `ADR 129 - Template-Tagged Literals for Extensions.md:42,76-80,120`; `docs/architecture docs/ADR-INDEX.md:39` (254 row: "`sql` is the one lowering tag") and `:136` (129 row lists `pg.sql`, `sqlite.sql`); `docs/reference/error-reference.md:600,632`; `docs/reference/psl-editor-tooling-tagged-literals.md:13,31`; `packages/2-sql/2-authoring/contract-psl/README.md:62`; `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md:639` (a `pg.sql` example).
