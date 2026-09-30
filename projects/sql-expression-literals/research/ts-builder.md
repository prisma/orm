# Research: the TypeScript contract builder and raw SQL

Scope: facts an implementer needs to make the TypeScript `sql` tag return a `sql/expression` value, and to make `.default()`, `index({ where, expression })`, `check({ expression })`, the five `policy*` helpers and `fullTextIndex({ where })` accept only that value. All paths are relative to the worktree root. Line numbers are as of commit `6a5b58ecb7`.

The id `sql/expression` does not exist anywhere in `packages/` yet (`grep -rn "sql/expression" packages` finds nothing).

## 1. The `sql` template tag

### 1.1 Source, in full

`packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts` (49 lines):

```ts
import type { ColumnDefault } from '@internal/contract/types';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  resolveTemplateTagEscapes,
} from '@internal/framework-components/control';
import { checkSqlDefaultBody, reservedSqlDefaultBody } from '@internal/sql-contract/validators';
import { contractError } from './contract-errors';

/**
 * A raw SQL column default written as a template literal: `` sql`gen_random_uuid()` ``. The raw text
 * between the backticks resolves `` \` ``, `\\` and `\$`, is canonicalized the way PSL canonicalizes a
 * tagged literal, and is used verbatim as the default expression. Interpolation is not supported, so
 * the two characters `${` are written `\${`.
 */
export function sql(strings: TemplateStringsArray, ...values: readonly never[]): ColumnDefault {
  if (values.length > 0) {
    throw contractError(
      'CONTRACT.DEFAULT_SQL_INTERPOLATION',
      'sql`...` does not support interpolation; write the SQL as one literal.',
      { meta: { interpolations: values.length } },
    );
  }
  const canonical = canonicalizeTaggedLiteralBody(resolveTemplateTagEscapes(strings.raw.join('')));
  if (!canonical.ok) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      describeTaggedLiteralFailure(canonical.reason),
      {
        meta: { reason: canonical.reason, offset: canonical.offset },
      },
    );
  }
  const reserved = reservedSqlDefaultBody(canonical.body);
  if (reserved !== undefined) {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      `Write .default(${reserved}()) instead of sql\`${reserved}()\`; ${reserved}() is a Prisma default function, not raw SQL.`,
      { meta: { reason: 'reserved-function', expression: canonical.body } },
    );
  }
  const rejected = checkSqlDefaultBody(canonical.body);
  if (rejected !== undefined) {
    throw contractError('CONTRACT.DEFAULT_INVALID', rejected, {
      meta: { reason: 'unsafe-sql', expression: canonical.body },
    });
  }
  return { kind: 'function', expression: canonical.body };
}
```

What the tag does, in order:

1. `...values: readonly never[]` makes any interpolation a type error. At runtime a non-empty `values` throws `CONTRACT.DEFAULT_SQL_INTERPOLATION` (line 18).
2. It reads `strings.raw.join('')`, so JavaScript escapes are not interpreted. `resolveTemplateTagEscapes` resolves only `` \` ``, `\\` and `\$` (`packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts:34`).
3. `canonicalizeTaggedLiteralBody` (same file, line 73) converts newlines to `\n`, drops a blank first and last line, removes common indentation, empties internal blank lines, and fails on NUL (`reason: 'nul'`) or a body over 65536 UTF-8 bytes (`reason: 'too-large'`, `TAGGED_LITERAL_MAX_BYTES` at line 13). Failure messages come from `describeTaggedLiteralFailure` (line 16): `'Tagged literals must not contain NUL characters.'` and `` `Tagged literal exceeds 65536 bytes.` ``. An empty body is accepted.
4. The two default-specific checks. `reservedSqlDefaultBody` and `checkSqlDefaultBody` live in `packages/2-sql/1-core/contract/src/default-sql-body.ts` and are exported from `@internal/sql-contract/validators` (`src/exports/validators.ts:1`):

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

5. It returns the framework contract type `ColumnDefault`, arm `{ kind: 'function', expression: <canonical body> }`.

Design note 7 says the default-specific refusals (steps 4) move from the tag into `.default()`. Steps 1 to 3 are not specific to defaults.

### 1.2 Error codes

Both codes are in the `ContractSubcode` union in `packages/2-sql/2-authoring/contract-ts/src/contract-errors.ts:6-35`:

- `'DEFAULT_INVALID'` (line 23). Used by the tag for canonicalization failure (line 27 of the tag), reserved function (line 37) and unsafe SQL (line 44). Also used elsewhere in contract-ts: `build-contract.ts:1032` (default and executionDefaults together), `build-contract.ts:1045` (nullable with executionDefaults), `contract-dsl.ts:501` (`defaultSql` on an enum field).
- `'DEFAULT_SQL_INTERPOLATION'` (line 24). Used only by the tag.

Meta shapes: interpolation `{ interpolations: number }`; canonicalization `{ reason: 'nul' | 'too-large', offset: number }`; reserved `{ reason: 'reserved-function', expression }`; unsafe `{ reason: 'unsafe-sql', expression }`.

The PSL twin applies the same two default checks in `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts:28-35`, with code `PSL_INVALID_DEFAULT_SQL` and the message `` `Write @default(${reserved}()) instead of ${literal.tag}\`${reserved}()\`; ...` ``. It returns `{ kind: 'storage', defaultValue: { kind: 'function', expression: literal.body } }` (line 38-41).

The planners also run `checkSqlDefaultBody` at planning time: `packages/3-targets/3-targets/postgres/src/core/migrations/planner-ddl-builders.ts:35` and `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-ddl-builders.ts:36` (imported from `@internal/family-sql/control`, which re-exports it at `packages/2-sql/9-family/src/exports/control.ts:15`).

### 1.3 Export and re-export paths

| Module | File | How `sql` is exported |
| --- | --- | --- |
| `@internal/sql-contract-ts/contract-builder` | `packages/2-sql/2-authoring/contract-ts/src/exports/contract-builder.ts:55` | `export { sql } from '../sql-default-literal';` |
| `@internal/postgres/contract-builder` | `packages/3-extensions/postgres/src/exports/contract-builder.ts:18-28` | named re-export from `@internal/sql-contract-ts/contract-builder` (with `autoincrement`, `buildSqlContractFromDefinition`, `check`, `field`, `member`, `model`, `now`, `rel`) |
| `@internal/sqlite/contract-builder` | `packages/3-extensions/sqlite/src/exports/contract-builder.ts:16-23` | named re-export (with `autoincrement`, `field`, `model`, `now`, `rel`). SQLite does not export `check`, `fullTextIndex` or the policy helpers. |
| `@prisma/orm-postgres/contract-builder` | `packages/9-public/@prisma/orm-postgres/src-gen/contract-builder.ts` | `export * from '@internal/postgres/contract-builder';` |
| `@prisma/orm-sqlite/contract-builder` | `packages/9-public/@prisma/orm-sqlite/src-gen/contract-builder.ts` | `export * from '@internal/sqlite/contract-builder';` |
| `@prisma/orm-family-sql/contract-ts/contract-builder` | `packages/9-public/@prisma/orm-family-sql/src-gen/contract-ts__contract-builder.ts` | `export * from '@internal/sql-contract-ts/contract-builder';` |
| `@prisma/orm-family-sql/contract-ts` | `packages/9-public/@prisma/orm-family-sql/src-gen/contract-ts.ts` | `export *` from `config-types` and `contract-builder` |

The `src-gen/` directories are gitignored (`packages/9-public/@prisma/orm-postgres/.gitignore:1`) and generated by `defineShellConfig` from `@repo/tsdown/shell-build` (`packages/9-public/@prisma/orm-postgres/tsdown.config.ts`). Because they use `export *`, any new export added to an internal `contract-builder` entry reaches the public package with no extra edit. The public `package.json` lists `"./contract-builder": "./dist/contract-builder.mjs"` (orm-postgres line 77, orm-sqlite line 75, orm-family-sql line 81).

The docs name the contract-ts file's other exports that matter here: types `CheckKind`, `ColumnRef`, `DeferredIndexColumn`, `DeferredIndexExpression`, `IndexConstraint`, `IndexExpressionInput`, `TargetFieldRef` (`exports/contract-builder.ts:33-41`), and `AuthoredColumnDefault`, `AuthoredColumnDefaultLiteralValue`, `CheckNode`, `IndexNode` (lines 19-32). `AuthoredCheckConstraint` is not exported.

### 1.4 The unrelated runtime `sql`

- Defined at `packages/2-sql/4-lanes/sql-builder/src/runtime/sql.ts:16`: `export function sql<C extends Contract<SqlStorage> & TableProxyContract>(options: SqlOptions<C>): Db<C>`. It builds the query-builder root (`db.sql`).
- Exported from `@internal/sql-builder/runtime` (`packages/2-sql/4-lanes/sql-builder/src/runtime/index.ts:6`, package export `"./runtime": "./dist/runtime/index.mjs"`).
- Public paths: `@prisma/orm-postgres/builder/runtime`, `@prisma/orm-sqlite/builder/runtime`, `@prisma/orm-family-sql/builder/runtime` (each `src-gen/builder__runtime.ts` is `export * from '@internal/sql-builder/runtime'`). `test/integration/test/packaging/facade-tarball.test.ts:187` asserts `@prisma/orm-postgres/builder/runtime` and `@prisma/orm-family-sql/builder/runtime` export the same `sql` object.
- Internal users import it aliased or unexported: `packages/3-extensions/postgres/src/runtime/postgres.ts:6` (`sql as sqlBuilder`), `postgres-serverless.ts:8`, `static/postgres-static.ts:4`, `packages/3-extensions/sqlite/src/runtime/sqlite.ts:7`, `sqlite/src/static/sqlite-static.ts:5`, `packages/3-extensions/supabase/src/runtime/supabase.ts:14`.
- No facade module exports both under one name. The contract tag is only on `.../contract-builder`; the runtime function is only on `.../builder/runtime`. The facades' `exports/control.ts` import the family descriptor as a local default named `sql` (`postgres/src/exports/control.ts:17`, `sqlite/src/exports/control.ts:8`) but do not export that name.

## 2. `ColumnDefault`, `.default()`, `.defaultSql()` and the path to `build-contract.ts`

### 2.1 Types

`packages/1-framework/0-foundation/contract/src/types.ts`:

```ts
export type JsonPrimitive = string | number | boolean | null;                       // 95
export type JsonValue =                                                              // 97
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export type ColumnDefaultLiteralValue = JsonValue;                                   // 102
export type ColumnDefaultLiteralInputValue = ColumnDefaultLiteralValue | Date;       // 104

export type ColumnDefault =                                                          // 128
  | {
      readonly kind: 'literal';
      readonly value: ColumnDefaultLiteralInputValue;
    }
  | { readonly kind: 'function'; readonly expression: string };

export function isColumnDefault(value: unknown): value is ColumnDefault {            // 135
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'literal') {
    return 'value' in value;
  }
  if (kind === 'function') {
    return typeof (value as { expression?: unknown }).expression === 'string';
  }
  return false;
}
```

`isColumnDefaultLiteralInputValue` (line 115) accepts JSON primitives, `Date`, arrays, and plain objects whose prototype is `Object.prototype`; it rejects class instances other than `Date`.

`ColumnDefault` is the contract storage shape too: `StorageColumn.default?: ColumnDefault` in the typed build output (`packages/2-sql/2-authoring/contract-ts/src/contract-types.ts:488`). It is not builder-only.

The definition tree's type, `packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts:44-61`:

```ts
export type AuthoredColumnDefaultLiteralValue =
  | ColumnDefaultLiteralInputValue
  | bigint
  | readonly AuthoredColumnDefaultLiteralValue[];

export type AuthoredColumnDefault =
  | ColumnDefault
  | {
      readonly kind: 'literal';
      readonly value: AuthoredColumnDefaultLiteralValue;
      readonly canonical?: boolean;
    };
```

`FieldNode.default?: AuthoredColumnDefault` (line 68) and `ValueObjectFieldNode.default?: AuthoredColumnDefault` (line 213). The PSL interpreter writes the same tree (`contract-psl/src/psl-column-resolution.ts:48` imports `AuthoredColumnDefault`).

The field builder's state holds `readonly default?: ColumnDefault | undefined` (`contract-dsl.ts:61` in `ScalarFieldState`, line 76 in `AnyScalarFieldState`).

### 2.2 `.default()` and helpers

`packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`:

```ts
function toColumnDefault(value: ColumnDefaultLiteralInputValue | ColumnDefault): ColumnDefault {   // 161
  if (isColumnDefault(value)) {
    return value;
  }
  return { kind: 'literal', value };
}

// class ScalarFieldBuilder, line 168
  default(value: ColumnDefaultLiteralInputValue | ColumnDefault): ScalarFieldBuilder<State> {      // 313
    return new ScalarFieldBuilder({
      ...this.state,
      default: toColumnDefault(value),
    }) as ScalarFieldBuilder<State>;
  }

  /**
   * @deprecated Write `.default(now())` or `.default(autoincrement())`, or `` .default(sql`...`) `` for any other SQL. Removed in 8.0.0.
   */
  defaultSql(expression: string): ScalarFieldBuilder<State> {                                       // 323
    return new ScalarFieldBuilder({
      ...this.state,
      default: { kind: 'function', expression },
    }) as ScalarFieldBuilder<State>;
  }
```

There is a single signature, no overloads. `.default()` performs no checks of its own. The return type does not change the typed state, so the value passed has no effect on the built contract's TypeScript type.

The enum builder overrides both (`contract-dsl.ts:471-506`):

```ts
  override default(value: Handle['values'][number]): EnumScalarFieldBuilder<Handle, State> {       // 487
    // stores { kind: 'literal', value }
  }

  override defaultSql(_expression: never): never {                                                  // 499
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      'defaultSql is not available on an enum field; use .default(members.X) instead',
      { meta: { reason: 'defaultSql-on-enum-field' } },
    );
  }
```

So `sql` defaults do not compile on an enum field today.

`now()` and `autoincrement()` (`packages/2-sql/2-authoring/contract-ts/src/default-functions.ts:4-11`) return `ColumnDefault` with `expression: 'now()'` and `'autoincrement()'`. Those exact bodies are what `reservedSqlDefaultBody` refuses. If the reserved check moves into `.default()`, it must run only on `sql/expression` values, or `.default(now())` would be refused.

`.defaultSql()` runs no canonicalization and no check. Its only users are its own test `packages/2-sql/2-authoring/contract-ts/test/contract-dsl.default-sql.deprecated.test.ts` (one case, lines 9-21), the enum test `packages/2-sql/2-authoring/contract-ts/test/enum-type.member-defaults.test.ts:50-53` (`@ts-expect-error`), and `packages/2-sql/2-authoring/contract-ts/README.md:64`. Pending upgrade instructions already describe its removal: `upgrade-instructions/pending/sql-default-literal/{app,extension}/instructions.md` and `upgrade-instructions/pending/remove-dbgenerated/extension/instructions.md`.

Field presets set a default without calling `.default()`: `buildFieldPreset` (`contract-dsl.ts:564-590`) copies `preset.default` from `instantiateAuthoringFieldPreset`. The framework template allows `{ kind: 'function', expression: AuthoringTemplateValue }` (`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:140-143`), resolved to `{ kind: 'function', expression: String(expression) }` at line 1863. No shipped pack preset uses a function default (`temporalAuthoringPresets` in `packages/2-sql/9-family/src/core/timestamp-now-generator.ts:49-82` uses execution defaults). Test fixtures do: `contract-ts/test/contract-builder.dsl.helpers.test.ts:50` and `contract-psl/test/ts-psl-parity.test.ts:44-49`.

### 2.3 How a default reaches the contract

1. `sql\`...\`` returns `{ kind: 'function', expression }`.
2. `.default(value)` stores `toColumnDefault(value)` in the builder state. `isColumnDefault` passes the object through unchanged.
3. `resolveModelNode` in `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts:845` calls `fieldBuilder.build()` and copies it: `...(fieldState.default ? { default: fieldState.default } : {})` (line 883) into a `FieldNode`.
4. `buildStorageColumn` in `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:710-756` calls `encodeColumnDefault(field.default, codec, field.many === true)` (lines 730-737; value-object fields at 716-719 with the JSONB codec).
5. `encodeColumnDefault` (`build-contract.ts:140-172`) returns a function default unchanged, before the list check: `if (defaultInput.kind === 'function') { return { kind: 'function', expression: defaultInput.expression }; }` (lines 145-147). Literal defaults go through the column codec.
6. The result is `StorageColumn.default` in `contract.json`.

Build-time default checks in `build-contract.ts`: line 1030-1041 (`CONTRACT.DEFAULT_INVALID`, `Field "<Model>.<field>" cannot define both default and executionDefaults.`, reason `default-and-executionDefaults`) and 1044-1054 (`cannot be nullable when executionDefaults are present.`). No check reads the function expression text.

## 3. `index()` and `check()`

### 3.1 Types (all in `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`)

```ts
export type IndexTypeMap = Record<string, { readonly options: unknown }>;              // 811

type IndexOptionsBase<Name extends string | undefined> = {                           // 813
  readonly name?: Name;
  /** Exact physical name — adopted verbatim, no wire hash. Xor `name`. */
  readonly map?: string;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where?: string;
  readonly unique?: boolean;
};

type IndexInput<                                                                     // 822
  Name extends string | undefined,
  IndexTypes extends IndexTypeMap,
> = keyof IndexTypes extends never
  ? IndexOptionsBase<Name>
  :
      | (IndexOptionsBase<Name> & { readonly type?: never; readonly options?: never })
      | {
          readonly [K in keyof IndexTypes & string]: IndexOptionsBase<Name> & {
            readonly type: K;
            readonly options: IndexTypes[K]['options'];
          };
        }[keyof IndexTypes & string];

type ExpressionIndexInput<                                                           // 841
  Name extends string | undefined,
  IndexTypes extends IndexTypeMap,
> = IndexInput<Name, IndexTypes> & { readonly expression: IndexExpressionInput };

export type DeferredIndexColumn = {                                                  // 885
  readonly name: string;
  readonly codecId: string;
};

export type DeferredIndexExpression = {                                              // 892
  readonly fields: readonly ColumnRef[];
  readonly render: (columns: readonly DeferredIndexColumn[]) => string;
};

/** Opaque SQL, either written out or rendered at lowering. */
export type IndexExpressionInput = string | DeferredIndexExpression;                  // 898

export type IndexConstraintElements<FieldNames extends readonly string[] = readonly string[]> =   // 901
  | { readonly fields: FieldNames; readonly expression?: never }
  | { readonly fields?: never; readonly expression: IndexExpressionInput };

export type IndexConstraintMethod =                                                  // 914
  | { readonly type?: undefined; readonly options?: undefined }
  | { readonly type: string; readonly options?: Record<string, unknown> };

export type IndexConstraint<                                                         // 918
  FieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = IndexConstraintElements<FieldNames> &
  IndexConstraintMethod & {
    readonly kind: 'index';
    readonly where?: string;
    readonly unique?: boolean;
    readonly name?: Name;
    readonly map?: string;
  };

export type AuthoredCheckConstraint = {                                              // 936
  readonly kind: 'check';
  readonly expression: string;
  readonly name?: string;
  readonly map?: string;
};
```

The doc block at lines 876-883 ("An index expression rendered at lowering ...") sits directly above the doc block of `DeferredIndexColumn` (884), so it documents nothing. It was meant for `DeferredIndexExpression`.

### 3.2 `index()` overloads and implementation

Inside `createConstraintsDsl` (`contract-dsl.ts:1045`):

```ts
  function index<                                                                    // 1102
    FieldNames extends readonly string[],
    const Name extends string | undefined = undefined,
  >(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: IndexInput<Name, IndexTypes>,
  ): IndexConstraint<FieldNames, Name>;
  function index<const Name extends string | undefined = undefined>(                 // 1109
    options: ExpressionIndexInput<Name, IndexTypes>,
  ): IndexConstraint<never, Name>;
  function index(                                                                    // 1112
    fieldsOrOptions:
      | ColumnRef
      | readonly ColumnRef[]
      | {
          readonly expression: IndexExpressionInput;
          readonly name?: string;
          readonly map?: string;
          readonly where?: string;
          readonly unique?: boolean;
          readonly type?: string;
          readonly options?: unknown;
        },
    options?: { /* same fields minus expression */ readonly where?: string; readonly options?: unknown; ... },
  ): IndexConstraint {
    const isExpressionForm =
      !Array.isArray(fieldsOrOptions) &&
      typeof fieldsOrOptions === 'object' &&
      'expression' in fieldsOrOptions;
    const opts = isExpressionForm ? fieldsOrOptions : options;
    const carried = {
      kind: 'index' as const,
      ...(opts?.where !== undefined ? { where: opts.where } : {}),
      // name, map, unique, type, options likewise
    };
    return isExpressionForm
      ? { ...carried, expression: fieldsOrOptions.expression }
      : { ...carried, fields: normalizeFieldRefInput(fieldsOrOptions) };
  }
```

`where` and `expression` are copied as given; the builder does not look at them. The implementation signature is not callable from outside, so its `unknown` is not a public escape hatch.

The `constraints.index` that users call inside `.sql(({ cols, constraints }) => ...)` is typed by `PackAwareIndex` (`contract-dsl.ts:1271-1279`), which repeats the two overloads with the same `IndexInput` and `ExpressionIndexInput` types. A change to those two types covers both. `SqlContext.constraints` is `PackAwareSqlConstraints` (1281-1293). `createConstraintsDsl()` is instantiated at lines 1359 and 1369.

`SqlStageSpec` (`contract-dsl.ts:1254-1260`):

```ts
export type SqlStageSpec = {
  readonly table?: string;
  readonly control?: ControlPolicy;
  readonly indexes?: readonly IndexConstraint[];
  readonly checks?: readonly AuthoredCheckConstraint[];
  readonly foreignKeys?: readonly ForeignKeyConstraint[];
};
```

`.sql<const NextSqlSpec extends SqlStageSpec>(...)` (line 1686) takes any object that fits `SqlStageSpec`. A user can therefore write an index or check object literal directly, for example `indexes: [{ kind: 'index', fields: ['email'], where: 'x' }]`, without calling `index()` or `check()`. The field types of `IndexConstraint` and `AuthoredCheckConstraint` are what decide whether a string compiles there.

### 3.3 How `where` and `expression` reach `lowerAuthoredIndex`

1. `resolveModelNode` (`contract-lowering.ts:894-926`) maps each `IndexConstraint` to an `IndexNode`. `where` is copied (line 903). For `expression`: `typeof index.expression === 'string' ? index.expression : index.expression.render(resolveDeferredColumns(spec, index.expression, fieldCodecIds))` (lines 911-918).
2. `resolveDeferredColumns` (`contract-lowering.ts:826-843`) maps each `ColumnRef` to `{ name: <storage column>, codecId }`, using the same field-to-column map as the fields form, and throws `InternalError` if a field resolves to nothing.
3. `IndexNode` (`contract-definition.ts:92-113`) holds strings: `expression: string` in the expression arm and `where: string | undefined`. The PSL interpreter builds the same node (`contract-psl/src/interpreter.ts:1074-1090`).
4. `build-contract.ts:1263-1282` calls `lowerAuthoredIndex(tableName, blindCast<AuthoredIndexInput, ...>({ columns, expression, where, unique, map, name, type, options }), authoringWarnings)`.
5. `lowerAuthoredIndex` (`packages/2-sql/1-core/contract/src/index-naming.ts:137-214`) validates (section 5), then hashes `computeIndexContentHash({ columns, expression, where, unique, type, options })` for wire names and returns `IndexInput` with `where` and `expression` carried as strings.

`computeIndexContentHash` (`packages/2-sql/1-core/schema-ir/src/naming.ts:249-263`) hashes `normalizeSqlBody(expression ?? '')` and `normalizeSqlBody(where ?? '')`, where `normalizeSqlBody = sql.replace(/\s+/g, ' ').trim()` (line 125).

### 3.4 `DeferredIndexExpression` and its only producer

`fullTextIndex` is the only non-test producer. Its `render` calls `renderFullTextIndexExpression(language, resolved.name)` from `@internal/target-postgres/sql-utils` (`packages/3-extensions/postgres/src/contract/full-text-index.ts:61-85`). The rendered string is generated by code, not written by the user. The test `packages/2-sql/2-authoring/contract-ts/test/contract-builder.deferred-index-expression.test.ts` defines its own `render` (line 35).

### 3.5 `check()`

```ts
export function check(input: {                                                      // 1236
  readonly expression: string;
  readonly name?: string;
  readonly map?: string;
}): AuthoredCheckConstraint {
  return {
    kind: 'check',
    expression: input.expression,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.map !== undefined ? { map: input.map } : {}),
  };
}
```

Path: `resolveModelNode` copies it to `CheckNode { expression, name, map }` (`contract-lowering.ts:929-935`; `CheckNode` at `contract-definition.ts:121-125`, `expression: string`). `build-contract.ts:1288-1306` calls `lowerAuthoredCheck(tableName, authoredCheck, authoringWarnings)` (`packages/2-sql/1-core/contract/src/authored-check-naming.ts:37-82`), which hashes `computeCheckContentHash(expression)` (`schema-ir/src/naming.ts:143-146`, over `normalizeSqlBody(expression)`), then `new CheckConstraint(lowered)`.

`check` is exported from `contract-ts/src/contract-builder.ts:615` and re-exported by the Postgres facade only.

## 4. Policy builders and `fullTextIndex`

### 4.1 Types in `packages/3-extensions/postgres/src/contract/rls.ts`

```ts
export interface RlsPolicyHandle<Operation extends RlsPolicyOperation = RlsPolicyOperation> {   // 43
  readonly entityKind: 'policy';
  readonly operation: Operation;
  readonly name: string;
  readonly refs: { readonly target: RlsTargetModel };
  readonly roles: readonly RlsRoleHandle[];
  readonly using?: string;
  readonly withCheck?: string;
}

export type RlsEntityHandle = RlsPolicyHandle | RlsRoleHandle | RlsEnablementHandle;           // 59

interface RlsPolicyDescriptorBase {                                                            // 61
  readonly name: string;
  readonly roles: readonly RlsRoleHandle[];
}

export interface RlsUsingPolicyDescriptor extends RlsPolicyDescriptorBase {                    // 68
  readonly using: string;
}

export interface RlsWithCheckPolicyDescriptor extends RlsPolicyDescriptorBase {                // 73
  readonly withCheck: string;
}

export type RlsUsingWithCheckPolicyDescriptor =                                                // 84
  | (RlsPolicyDescriptorBase & {
      readonly using: string;
      readonly withCheck?: string;
    })
  | (RlsPolicyDescriptorBase & {
      readonly using?: string;
      readonly withCheck: string;
    });
```

Helpers (lines 187-225), each a single signature:

```ts
export function policySelect(model: RlsTargetModel, descriptor: RlsUsingPolicyDescriptor): RlsPolicyHandle<'select'>
export function policyInsert(model: RlsTargetModel, descriptor: RlsWithCheckPolicyDescriptor): RlsPolicyHandle<'insert'>
export function policyUpdate(model: RlsTargetModel, descriptor: RlsUsingWithCheckPolicyDescriptor): RlsPolicyHandle<'update'>
export function policyDelete(model: RlsTargetModel, descriptor: RlsUsingPolicyDescriptor): RlsPolicyHandle<'delete'>
export function policyAll(model: RlsTargetModel, descriptor: RlsUsingWithCheckPolicyDescriptor): RlsPolicyHandle<'all'>
```

All call `buildPolicyHandle(operation, model, descriptor)` (lines 112-165), whose parameter is `RlsPolicyDescriptorBase & { readonly using?: string; readonly withCheck?: string }`. It checks the name and the per-operation predicate matrix (`POLICY_OPERATION_PREDICATES` from `@internal/target-postgres/rls-canonicalize`) and returns a frozen handle with `using`/`withCheck` copied as given (`...ifDefined('using', descriptor.using)`, lines 162-163). It does not look at predicate text.

The TypeScript helpers cannot author `permissive` (always PERMISSIVE) or an exact name (PSL `@@map`). The type test says so explicitly (`rls-handles.test-d.ts:84-89`).

All these names are exported from `packages/3-extensions/postgres/src/exports/contract-builder.ts:33-49`, including the handle and descriptor types.

The Postgres `defineContract` narrows `entities?: readonly RlsEntityHandle[]` (`packages/3-extensions/postgres/src/contract/define-contract.ts:59`). The generic contract-ts `ContractInput.entities` is `readonly PackEntityHandle[]` (`contract-ts/src/contract-builder.ts:83, 109, 123, 386`), where `PackEntityHandle = { readonly entityKind: string; readonly refs?: Readonly<Record<string, unknown>> }` (`packages/2-sql/1-core/contract/src/entity-handle-lowering-hook.ts:25-28`).

### 4.2 Path to `postgresLowerEntityHandles` and `buildRlsPolicyEntity`

1. `lowerPackEntityHandles` in `packages/2-sql/2-authoring/contract-ts/src/contract-lowering.ts:1090-1214` groups handles by the pack that registered their `entityKind`, resolves `refs` to table coordinates, and calls `authoring.lowerEntityHandles({ handles, defaultNamespaceId })` (line 1197). It passes the handle object through untouched.
2. The Postgres pack registers `lowerEntityHandles: postgresLowerEntityHandles` (`packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts:31`).
3. `postgresLowerEntityHandles` (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:1065-1200`) casts each policy handle with `blindCast<RlsPolicyHandleShape, 'policy handles are constructed only by the postgres contract-builder policy*() constructors, which enforce this shape'>(handle)` (lines 1123-1127). The target's own copy of the shape (lines 1012-1019):

```ts
interface RlsPolicyHandleShape {
  readonly entityKind: 'policy';
  readonly operation: RlsPolicyOperation;
  readonly name: string;
  readonly roles: readonly { readonly name: string }[];
  readonly using?: string;
  readonly withCheck?: string;
}
```

4. At lines 1168-1181 it calls `buildRlsPolicyEntity({ prefix, tableName, namespaceId, operation, roles, ...ifDefined('using', policy.using), ...ifDefined('withCheck', policy.withCheck) })`.
5. `buildRlsPolicyEntity` (`authoring.ts:215-247`) takes `using?: string` and `withCheck?: string`, hashes `normalizeSqlBody(using)` and `normalizeSqlBody(withCheck)` with roles, operation and permissive, and constructs `new PostgresRlsPolicy({ naming: { kind: 'wire', prefix, hash }, ..., using, withCheck, permissive })`. `PostgresRlsPolicy` (`packages/3-targets/3-targets/postgres/src/core/postgres-rls-policy.ts:52-78`) stores `using?: string`, `withCheck?: string` and does not validate them.

The PSL path uses the same `buildRlsPolicyEntity` (`authoring.ts:325-334`) after `unwrapQuotedString(readValueParam(block, 'using'))` (lines 278-279).

Layering fact: `@internal/target-postgres` does not depend on `@internal/sql-contract-ts` (`packages/3-targets/3-targets/postgres/package.json` dependencies, lines 19-32; `@internal/sql-contract-psl` is a dev dependency only). It depends on `@internal/sql-contract`, `@internal/family-sql` and `@internal/framework-components`. If a policy handle carries a `sql/expression` object instead of a string, the target can only name that object's type if it is defined in one of those packages, or the `policy*` helpers must unwrap it to a string before building the handle. `@internal/postgres` (the extension) depends on both `@internal/sql-contract-ts` and `@internal/target-postgres` (`packages/3-extensions/postgres/package.json:21-37`). `@internal/sql-contract-ts` depends on `@internal/sql-contract` and `@internal/framework-components`.

### 4.3 `fullTextIndex`

`packages/3-extensions/postgres/src/contract/full-text-index.ts`:

```ts
type FullTextIndexOptionsBase = {                                                    // 11
  readonly language?: FullTextSearchLanguage;
  /** The SQL predicate restricting rows included in a partial index. */
  readonly where?: string;
};

type FullTextIndexNameOptions<Name extends string = string> = FullTextIndexOptionsBase & {    // 21
  readonly name: Name;
  readonly map?: never;
};

type FullTextIndexMapOptions = FullTextIndexOptionsBase & {                         // 27
  readonly map: string;
  readonly name?: never;
};

export function fullTextIndex<const Name extends string>(                            // 44
  column: ColumnRef,
  options: FullTextIndexNameOptions<Name>,
): IndexConstraint<never, Name>;
export function fullTextIndex(                                                       // 48
  column: ColumnRef,
  options: FullTextIndexMapOptions,
): IndexConstraint<never, undefined>;
```

The implementation (52-92) returns an `IndexConstraint` literal with `expression: { fields: [column], render }`, `type: 'gin'`, and `...(options.where !== undefined ? { where: options.where } : {})` (line 88). Its `where` is the same `IndexConstraint.where` field that `index()` fills, so it follows the index path in section 3.3.

## 5. Build-time validation of TypeScript-built values

None of these checks look at SQL text except the empty-check guard. There is no check that a value is a string, because the types say string.

| Where | Code | Condition and message |
| --- | --- | --- |
| `packages/2-sql/1-core/contract/src/index-naming.ts:142-147` | `CONTRACT.ARGUMENT_INVALID` | columns and expression both or neither: `` Index on table "${tableName}": an index takes either fields (columns) or an expression — exactly one, not both. `` |
| `index-naming.ts:148-153` | `CONTRACT.ARGUMENT_INVALID` | map and name both: `` Index "${authored.map}" on table "${tableName}": map and name are mutually exclusive — map adopts an exact physical name, name is a wire prefix. `` |
| `index-naming.ts:154-163` | `CONTRACT.ARGUMENT_INVALID` | expression without name or map: `` Index on table "${tableName}": an expression index requires an explicit name (name:) or exact physical name (map:) — a default name cannot be derived from an expression. `` |
| `index-naming.ts:164-169` | `CONTRACT.ARGUMENT_INVALID` | options without type: `` Index on table "${tableName}": options requires an explicit type — ... `` |
| `index-naming.ts:173-181` | warning `PN_EXACT_NAME_BODY_COMPARISON` | `map` with `expression` or `where` (`exactNameBodyWarning('index', map)`, line 115) |
| `index-naming.ts:195` | (from `assertWireNamePrefixLength`) | wire prefix too long |
| `packages/2-sql/1-core/contract/src/authored-check-naming.ts:42-47` | `CONTRACT.ARGUMENT_INVALID` | map and name both: `` Check "${authored.map}" on table "${tableName}": map and name are mutually exclusive — ... `` |
| `authored-check-naming.ts:48-53` | `CONTRACT.ARGUMENT_INVALID` | `authored.expression.trim().length === 0`: `` Check on table "${tableName}": expression must not be empty — an empty predicate is not a constraint. `` |
| `authored-check-naming.ts:55-61` | warning `PN_EXACT_NAME_BODY_COMPARISON` | any `map` |
| `authored-check-naming.ts:68-73` | `CONTRACT.ARGUMENT_INVALID` | neither name nor map: `` Check on table "${tableName}": a check constraint requires an explicit name (name:) or exact physical name (map:) — ... `` |
| `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:1251-1256` | `CONTRACT.CHECK_ON_STI_VARIANT` | check on a model that shares its base table |
| `build-contract.ts:1292-1303` | `CONTRACT.CHECK_NAME_RESERVED` | wire prefix collides with a derived-check prefix |
| `packages/2-sql/1-core/contract/src/ir/check-constraint.ts:36-46` | `ContractValidationError` | empty physical name |
| `packages/2-sql/1-core/contract/src/ir/sql-index.ts:78-88` | `ContractValidationError` | unnamed expression index; columns xor expression |
| `packages/3-extensions/postgres/src/contract/rls.ts:94-101` | `CONTRACT.POLICY_INVALID` | empty name: `` ${helper}: name must be a non-empty string. `` (also used by `role()`, line 174) |
| `rls.ts:133-144` | `CONTRACT.POLICY_INVALID` | predicate the operation does not take: `` ${helper}: policy "${name}" does not take a \`${predicate}\` predicate; the ${OP} operation uses ${supported}. `` |
| `rls.ts:145-154` | `CONTRACT.POLICY_INVALID` | no predicate: `` ${helper}: policy "${name}" requires at least one predicate; the ${OP} operation uses ${supported}. `` |
| `packages/3-targets/3-targets/postgres/src/core/authoring.ts:1037-1050` | `CONTRACT.POLICY_INVALID` / `CONTRACT.MODEL_UNKNOWN` | cross-space target / unknown model (`requireLocalTarget`) |
| `authoring.ts:1143-1156` | `CONTRACT.POLICY_INVALID` | target table not RLS-enabled |
| `authoring.ts:1158-1165` | `CONTRACT.POLICY_INVALID` | duplicate prefix in a namespace |
| `authoring.ts:1105-1110` | `CONTRACT.ROLE_INVALID` | role declared twice |
| `authoring.ts:1136` | (from `assertWireNamePrefixLength`) | policy prefix too long |
| `packages/3-extensions/postgres/src/contract/full-text-index.ts:69-83` | `CONTRACT.INDEX_INVALID` | column codec is not text-like; raised inside `render` at lowering |
| `packages/3-targets/3-targets/sqlite/src/core/sqlite-unbound-database.ts:114-119` | `CONTRACT.ARGUMENT_INVALID` | SQLite index with `expression` or `where` |

Error-code unions: contract-ts `packages/2-sql/2-authoring/contract-ts/src/contract-errors.ts:6-35`; sql-contract core `packages/2-sql/1-core/contract/src/contract-errors.ts:6-10` (`ARGUMENT_INVALID`, `PACK_CONTRIBUTION_INVALID`, `TABLE_AMBIGUOUS`, `VALIDATION_FAILED`); Postgres extension `packages/3-extensions/postgres/src/errors.ts:4-11` (`CONTRACT.ENUM_INVALID`, `CONTRACT.INDEX_INVALID`, `CONTRACT.POLICY_INVALID`, runtime and driver codes); Postgres target `packages/3-targets/3-targets/postgres/src/core/errors.ts:5-25`. There is no `CONTRACT.CHECK_INVALID`. The check codes are `CHECK_NAME_RESERVED`, `CHECK_ON_STI_VARIANT` and `CHECK_OPTOUT_INVALID` (the last is `noCheck()`).

`postgresError('CONTRACT.POLICY_INVALID', ...)` in `contract-to-postgres-database-schema-node.ts:247, 255` and `CONTRACT.INDEX_INVALID` in `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:2076` run at migration and DDL time, not at build.

## 6. Tests, parity fixtures and every TypeScript caller that passes strings

### 6.1 The `sql` tag and `.default()`

- `packages/2-sql/2-authoring/contract-ts/test/sql-default-literal.test-d.ts` (one test): `expectTypeOf(sql\`gen_random_uuid()\`).toEqualTypeOf<ColumnDefault>()` and `@ts-expect-error` on interpolation.
- `packages/2-sql/2-authoring/contract-ts/test/sql-default-literal.test.ts` (12 cases, lines 17-110): every expectation is `{ kind: 'function', expression }`; covers multi-line canonicalization, empty body (`sql\`\`` → `''`), interpolation error (via a cast to an untyped tag, line 41), raw `${` text, raw escapes, the three tag escapes, reserved `now()`/`autoincrement()` messages, `NOW()`/`uuid()` pass-through, unsafe SQL message.
- `packages/3-extensions/postgres/test/contract-builder/sql-default.test.ts` (2 cases): `now()`/`autoincrement()` shapes and `.default(sql\`gen_random_uuid()\`)` through `defineContract`.
- `packages/2-sql/2-authoring/contract-ts/test/contract-builder.dsl.portability.test.ts:54` (`.default(sql\`CURRENT_TIMESTAMP\`)`), expectation at 110-113.
- `test/e2e/framework/test/sqlite/migrations/widening.test.ts:2, 110, 130-141`: imports `sql` from `@prisma/orm-sqlite/contract-builder`; `it.each` passes `sql\`CURRENT_TIMESTAMP\`` and `sql\`'x'\`` values into `.default(columnDefault)`.
- `packages/2-sql/2-authoring/contract-ts/test/contract-dsl.default-sql.deprecated.test.ts` (1 case, `.defaultSql('now()')`).
- `.default()` with a raw `ColumnDefault` object (these compile today and would keep compiling through the JSON-object branch, see 8.1): `packages/2-sql/2-authoring/contract-ts/test/contract-dsl.runtime.test.ts:47` (`.default({ kind: 'function', expression: 'now()' })`), `packages/3-extensions/sql-orm-client/test/helpers.ts:595` (`builder.default({ kind: 'function', expression: col.default })` for string `col.default`), `test/e2e/framework/test/fixtures/contract.ts:113` (`.default({ kind: 'literal', value: '2024-01-15 10:30:00+00' })`).

No type test covers `.default()` signatures (`contract-builder.dsl.types.test.ts` and `test/integration/test/contract-builder.types.test-d.ts` only use `.default(autoincrement())` and `.default(true)`, lines 222 and 225 of the latter).

### 6.2 `index()` and `fullTextIndex()` call sites with string SQL

| File | Call sites with a string `expression` / `where` |
| --- | --- |
| `packages/2-sql/2-authoring/contract-ts/test/contract-builder.index-naming.test.ts` | 4: `expression` at 264, 342, 371; `where` at 291 |
| `packages/2-sql/2-authoring/contract-ts/test/contract-builder.deferred-index-expression.test.ts` | 1: `expression` at 103 (plus the deferred form at 57) |
| `packages/2-sql/2-authoring/contract-ts/test/contract-builder.duplicate-names.test-d.ts` | 1: `expression` at 82 (type test) |
| `packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts` | 2: `expression` at 507; `expression` + `where` at 582-583 (PSL-vs-TS parity unit test) |
| `packages/3-extensions/postgres/test/contract-builder/full-text-index.test.ts` | 1: `where` at 134 |
| `test/integration/test/sql-builder/fixtures/contract.ts` | 1: `fullTextIndex(cols.body, { where: 'post_id = 1', ... })` at 53 |
| `test/integration/test/family.schema-verify.index-drift.integration.test.ts` | 1: `expression` at 61 |
| `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-expression-authored.ts` | 3: `expression` at 16 and 26, `where` at 22 |

`packages/3-extensions/postgres/test/contract-builder/full-text-index.test-d.ts` has no `where`.

### 6.3 `check()` call sites

- `packages/2-sql/2-authoring/contract-ts/test/check-constraint.authoring.test.ts`: 14 `check({ expression: '...' })` calls (lines 1195-1507), including the empty-expression case at 1235.
- `packages/2-sql/2-authoring/contract-psl/test/interpreter.check-attribute.test.ts`: 4 (lines 81, 122, 168, 169), used as the TS-built expected contract for PSL.
- `packages/3-targets/6-adapters/postgres/test/migrations/check-lifecycle-e2e.integration.test.ts`: 2 helper sites `check(input)` (224, 252) where `input.expression: string` (210, 238), fed by string expressions at about 909, 935, 944, 966, 974, 996, 1018.

### 6.4 Policy call sites

Counts are lines matching `using: '...'` / `withCheck: '...'` (literal strings, including some expected values), plus variable forms.

| File | Literal `using` / `withCheck` | Other |
| --- | --- | --- |
| `packages/3-extensions/postgres/test/contract-builder/rls-handles.test.ts` | 20 / 11 | `toEqual` expectations assert the handle holds the string (for example 137-145) |
| `packages/3-extensions/postgres/test/contract-builder/rls-handles.test-d.ts` | 6 / 5 | asserts `RlsUsingPolicyDescriptor['using']` and `RlsWithCheckPolicyDescriptor['withCheck']` equal `string` (71-72); `Extract<..., { using: string }>` (87); a `{ roles: string[]; using: string }` shape (92-96) |
| `packages/3-extensions/postgres/test/contract-builder/rls-entities.test.ts` | 14 / 4 | `const usingSql = "owner_id = current_setting('app.uid')::int"` (69) reused at 76-188 |
| `packages/3-extensions/postgres/test/structured-errors.test.ts` | 1 / 1 | 95, 104 (104 via an untyped cast) |
| `test/integration/test/rls-ts-walking-skeleton.integration.test.ts` | 0 / 0 | helper parameter typed `using: string` (95, 108); `OWNER_PREDICATE` (79) and `EDITED_PREDICATE = \`${OWNER_PREDICATE} AND deleted_at IS NULL\`` (80) built with JavaScript interpolation, which the `sql` tag refuses |
| `test/integration/test/rls-helper-invisibility.test.ts` | 1 / 0 | line 55 |
| `test/integration/test/authoring/parity/ts-psl-rls-parity.test.ts` | 3 / 1 | `OWNER_PREDICATE` const (74) at 101, 107, 108, 114, 119, 131 |
| `test/integration/test/authoring/parity/rls/contract.ts` | 3 / 1 | `ownerPredicate` const (18) at 41, 47, 48, 53, 58, 69 |

### 6.5 Parity fixtures under `test/integration/test/authoring/parity/`

Runner: `test/integration/test/authoring/cli.emit-parity-fixtures.test.ts`, via `listAuthoringParityFixtureCases()` in `test/integration/test/authoring/authoring-parity-test-helpers.ts:38`. Every directory must hold `contract.ts`, `schema.prisma`, `packs.ts`, `expected.contract.json`. `fixtures:check` diffs `**/contract.*` and `**/expected.contract.json` (root `package.json:60`).

| Fixture | Raw SQL covered | Form |
| --- | --- | --- |
| `default-sql-literal/` | 6 column defaults | TS: `sql` tag (`contract.ts:8-17`). PSL: `sql` backtick, `sql"..."` double-quote, and `` pg.sql`(now() + interval '1 hour')` `` at `schema.prisma:7`, which uses the prefixed tag this project removes. |
| `rls/` | 9 policies | TS: plain strings (`ownerPredicate` and `'true'`). PSL: quoted strings with `\"` escapes (`schema.prisma:22-66`). |
| `core-surface/`, `map-attributes/` | fields-only `@@index` | no raw SQL |

No parity fixture covers a partial index, an expression index, `@@fullTextIndex`, or `@@check`. PSL-vs-TS parity for expression and partial indexes exists only in the unit test `packages/2-sql/2-authoring/contract-psl/test/ts-psl-parity.test.ts:476-610`; for checks only in `contract-psl/test/interpreter.check-attribute.test.ts`.

`test/integration/test/authoring/side-by-side/` and `test/integration/test/authoring/diagnostics/` hold no index `where`/`expression`, check or policy SQL.

### 6.6 `contract.ts` files and examples

- `examples/prisma-8-demo/prisma/contract.ts`: imports `sql` from `@prisma/orm-postgres/contract-builder` (line 9); `.default(sql\`(now() + '7 days'::interval)\`)` at 53; `fullTextIndex(cols.title, { name: 'post_title_search' })` at 72 (no `where`). No plain-string raw SQL.
- `examples/prisma-8-demo-sqlite/prisma/contract.ts`, `examples/paradedb-demo/prisma/contract.ts`, `examples/bundle-size/src/postgres/contract.ts`, `examples/react-router-demo/src/prisma/contract.ts`: no raw SQL fields.
- `examples/supabase` is PSL (`src/contract.prisma`).
- `test/integration/test/authoring/parity/rls/contract.ts`: 9 plain-string predicates.
- `test/integration/test/authoring/parity/default-sql-literal/contract.ts`: 6 `sql` defaults.
- `test/integration/test/sql-builder/fixtures/contract.ts`: 1 plain-string `where`.
- `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-expression-authored.ts`: 3 plain strings.
- `test/e2e/framework/test/fixtures/contract.ts`: one raw literal `ColumnDefault` object (not raw SQL).
- `packages/3-extensions/pgvector/src/contract.ts` and `packages/3-extensions/postgis/src/contract.ts` use `defineContract` from `@internal/postgres/contract-builder` with no raw SQL.

### 6.7 Docs that show the TypeScript forms (for the docs sweep)

- `packages/2-sql/2-authoring/contract-ts/README.md:64` (`.default(sql...)`, `.defaultSql` deprecation), `:241-248` (`where: '(archived_at IS NULL)'`, `expression: 'eql_v3.eq_term(email)'`, deferred form).
- `docs/architecture docs/adrs/ADR 234 - Content-addressed wire names for Postgres-normalized objects.md:26-30, 129` (TS policies with plain strings).
- `docs/architecture docs/adrs/ADR 129 - Template-Tagged Literals for Extensions.md:22, 70, 88-94` (TS tag behaviour and the two default checks).
- `docs/architecture docs/adrs/ADR 244 ...:152` and `ADR 243 ...:15` (mention `check({ expression, name })`).
- `docs/architecture docs/subsystems/5. Adapters & Targets.md:299`.
- `skills/prisma-8/references/contract.md:127, 137, 322`, `skills/prisma-8/references/supabase.md:100`, `skills/prisma-8/references/queries-postgres.md:99`.

## 7. Extensions and other callers

- Supabase builds its contract from PSL: `packages/3-extensions/supabase/prisma.config.ts` uses `prismaContract('src/contract/contract.prisma', ...)`; `scripts/generate-contract.ts` regenerates that PSL from a database. Its test fixtures (`test/fixtures/{example-app,no-policy,renamed-policy}`) are PSL too. The PSL holds plain-string `where` (for example `contract.prisma:74-79`), `expression` (`:80`) and `@@check(expression: ...)` (43 in total; for example `:83, 126-129, 158, 193`). It has 11 plain-string `where:` arguments. Its TypeScript files use only `extensionModel` and `field` (`src/contract/handles.ts:13`) and `enumType`, `member` (`src/contract/roles.ts:2`, which mentions `policySelect` in a doc comment at line 32). No TypeScript raw SQL.
- `fullTextIndex` (`packages/3-extensions/postgres/src/contract/full-text-index.ts`) is the only non-test source that builds an `IndexConstraint` with a `where`, and it forwards the caller's value.
- `rls.ts` `buildPolicyHandle` is the only non-test source that builds a policy handle.
- No other package in `packages/*/src`, `apps/`, or the CLI calls `index({ where/expression })`, `check()`, the policy helpers, or `.default(sql...)`.
- `buildSqlContractFromDefinition(definition: ContractDefinition, codecLookup?)` (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:956`) is re-exported from the Postgres facade together with the `IndexNode` and `CheckNode` types. It takes the definition tree, whose `where`, `expression` and check `expression` are strings. This is a public path that takes raw SQL as strings; it is the lowered form PSL also produces.

## 8. How TypeScript would reject a plain string, and what would still let one through

### 8.1 `.default()`

- A plain string is a valid literal default: `ColumnDefaultLiteralInputValue` includes `string`. `.default('draft')` must keep compiling. "A plain string does not compile" applies to raw SQL, which for defaults means the raw-SQL form must be a `sql/expression` value and not a string.
- The parameter type includes `ColumnDefault`, so `.default({ kind: 'function', expression: '...' })` compiles today and `toColumnDefault` stores it as raw SQL without canonicalization or checks.
- Removing `ColumnDefault` from the parameter does not close this. `JsonValue` includes `{ readonly [key: string]: JsonValue }`, so the object literal `{ kind: 'function', expression: '...' }` still type-checks as a literal value, and at runtime `isColumnDefault` still recognizes it as a function default.
- TypeScript assignability rule, checked with TypeScript 5.9.3 in memory: an object type declared with `type X = { readonly kind: ...; readonly body: string }` is assignable to `JsonValue | Date` (type aliases get an implicit index signature). An `interface` with the same members, and a `class` instance type, are not assignable. So if the `sql/expression` value type is a plain type alias, it overlaps the literal branch of `.default()`; if it is a class or interface, the two do not overlap. At runtime `isColumnDefaultLiteralInputValue` rejects class instances (prototype check at `types.ts:122`), so a class instance can be told apart from a literal.
- `now()` and `autoincrement()` return `ColumnDefault`; `.default()` must keep accepting them without the reserved-body check.
- `EnumScalarFieldBuilder.default` accepts only `Handle['values'][number]`.
- Field presets bypass `.default()` (section 2.2).

### 8.2 Index, check, fullTextIndex, policies: every place typed `string`

- `IndexOptionsBase.where?: string` (`contract-dsl.ts:817`), shared by both `index()` overloads and `PackAwareIndex`.
- `IndexExpressionInput = string | DeferredIndexExpression` (`:898`), used by `ExpressionIndexInput` and `IndexConstraintElements`.
- `IndexConstraint.where?: string` (`:924`). `IndexConstraint` is exported and is what `.sql({ indexes })` accepts, so an object literal bypasses `index()`.
- `DeferredIndexExpression.render` returns `string` (`:894`). Its text is generated by code (`fullTextIndex`), not written by the user.
- `check()` input `expression: string` (`:1237`) and `AuthoredCheckConstraint.expression: string` (`:938`). `.sql({ checks })` accepts an object literal of that shape.
- `FullTextIndexOptionsBase.where?: string` (`full-text-index.ts:14`).
- `RlsUsingPolicyDescriptor.using: string`, `RlsWithCheckPolicyDescriptor.withCheck: string`, both arms of `RlsUsingWithCheckPolicyDescriptor` (`rls.ts:68-92`); `buildPolicyHandle` parameter (`:115-118`).
- `RlsPolicyHandle.using?: string`, `withCheck?: string` (`rls.ts:51-52`). The type is exported and is an element of `RlsEntityHandle`, so a handwritten handle object in `entities` bypasses the helpers.
- Target side: `RlsPolicyHandleShape.using?/withCheck?: string` (`authoring.ts:1017-1018`) reached through `blindCast`; `buildRlsPolicyEntity` input (`authoring.ts:221-222`); `PostgresRlsPolicyInput.using/withCheck: string | undefined` (`postgres-rls-policy.ts:18, 20`).
- Definition tree: `IndexNode.where: string | undefined`, `IndexNode.expression: string`, `CheckNode.expression: string` (`contract-definition.ts:102, 108, 122`), and `AuthoredIndexInput` / `AuthoredCheckInput` in `@internal/sql-contract` (`index-naming.ts:18-46`, `authored-check-naming.ts:20-24`). The spec says the contract keeps strings, and PSL writes this tree, so these are the point where the value is unwrapped, not user-facing fields.

### 8.3 Overloads and loose types

- `index()` has two public overloads (fields form, expression form). Both take the SQL through `IndexInput` / `ExpressionIndexInput`; no third public overload exists. The implementation signature's `options?: unknown` is not callable.
- `fullTextIndex` has two overloads (name form, map form); both use `FullTextIndexOptionsBase`.
- Policy helpers and `check()` have one signature each.
- Runtime backstops for untyped JavaScript callers: `buildPolicyHandle` checks the predicate matrix but not predicate types; `lowerAuthoredCheck` calls `authored.expression.trim()`, so a non-string throws a `TypeError`; `isAuthoredIndexInput` (`index-naming.ts:56-75`) checks `typeof expression === 'string'` and `where` is optional string, but only the PSL interpreter calls it (`contract-psl/src/interpreter.ts:1197`), not the TypeScript path.
- No `any` in these signatures. `unknown` appears in `IndexTypeMap` options, the implementation signature, `PackEntityHandle.refs`, and the generic contract-ts `entities?: readonly PackEntityHandle[]`, which accepts any object with a string `entityKind`. The Postgres `defineContract` narrows that to `RlsEntityHandle`.
- Type tests that would change: `rls-handles.test-d.ts:71-72, 87, 92-96` assert `string`; `sql-default-literal.test-d.ts:6` asserts `ColumnDefault`.

## 9. Facts that constrain the design

- The reserved-body check must not run on `now()` / `autoincrement()` results, which are `ColumnDefault` objects with those exact bodies.
- The tag's canonicalization failure and interpolation errors currently carry default-specific codes (`CONTRACT.DEFAULT_INVALID`, `CONTRACT.DEFAULT_SQL_INTERPOLATION`) although they are not about defaults.
- The contract-ts package already depends on `@internal/framework-components` (for `canonicalizeTaggedLiteralBody`, from its `/control` entry) and `@internal/sql-contract` (for the validators). The Postgres target depends on `@internal/sql-contract` but not on contract-ts.
- `sql\`\`` (empty body) is accepted by the tag today. `lowerAuthoredCheck` refuses an empty check expression at build; nothing refuses an empty index `where`/`expression` or policy predicate.
- Two tests build predicates with JavaScript interpolation or shared constants (`rls-ts-walking-skeleton.integration.test.ts:79-80`, `rls-entities.test.ts:69`, `ts-psl-rls-parity.test.ts:74`, `parity/rls/contract.ts:18`). With a tag that refuses interpolation, a shared value must be a `sql/expression` constant, and `EDITED_PREDICATE` must be written out in full.
- The TypeScript policy helpers cannot express `permissive` or an exact name. That gap is separate from this project.
