# Research: raw SQL embedded in migration DDL (design decision 9)

Scope: every place the Postgres and SQLite migration planners paste raw SQL text from the contract (or from a migration file) into a larger statement. Facts only. Paths are relative to the repo root. Line numbers are at commit `6a5b58ecb7`.

Abbreviations used below:

- `RC` = `packages/2-sql/4-lanes/relational-core/src`
- `PGT` = `packages/3-targets/3-targets/postgres/src`
- `PGA` = `packages/3-targets/6-adapters/postgres/src`
- `SLT` = `packages/3-targets/3-targets/sqlite/src`
- `SLA` = `packages/3-targets/6-adapters/sqlite/src`

## Summary of findings

1. Raw SQL reaches the database through two different kinds of code. Some sites build a typed DDL node that the adapter renders (`lowerToExecuteRequest`). Other sites paste the string into a SQL template inside `operations/*.ts` or `planner-ddl-builders.ts` and never build a DDL node.
2. Typed-node sites (Postgres): column `DEFAULT` in `CREATE TABLE` and `ADD COLUMN`, table-level `CHECK` inside `CREATE TABLE`, policy `USING` / `WITH CHECK`, index expression list, index `WHERE`.
3. Raw-template sites (Postgres): `ALTER TABLE … ADD CONSTRAINT … CHECK (…)` for a check added to an existing table, `ALTER COLUMN … SET DEFAULT (…)`, `ALTER COLUMN … TYPE … USING …`, and the data-transform `SELECT [NOT] EXISTS (…)` wrapper.
4. SQLite: only `CREATE TABLE` uses a typed node (column `DEFAULT`). `ADD COLUMN` and the table rebuild (`recreateTable`) paste a pre-rendered `DEFAULT (…)` string. SQLite refuses CHECK constraints at three places. The SQLite planner silently ignores an index's `where` and `expression` (it passes `index.columns ?? []`).
5. No generated-column DDL exists anywhere.
6. No site escapes or transforms a body: every body is inserted verbatim. Every site except `ALTER COLUMN TYPE … USING` places a closing token after the body on the same line, so a body whose last line ends in a `--` comment breaks the statement at every site except that one.
7. Committed `migration.ts` files pass these bodies as plain strings to `fn(…)`, `checkExpression(…)`, and `this.createIndex({ expression: … })`. No committed `ops.json` contains `--`. `migrate` reads `ops.json` only; nothing re-runs `migration.ts` at apply time (emit-drift detection is documented as not implemented).
8. `RawExpr` lives in the same package as the DDL node classes, but both adapters' `RawExpr` renderers are module-private, require a query-render context (contract plus parameter index map on Postgres), and add no enclosing parentheses or line breaks.

## 1. DDL node classes and fields that hold raw SQL

### 1.1 Family-level DDL types: `RC/ast/ddl-types.ts`

Column defaults use a visitor interface with a render context:

```ts
// RC/ast/ddl-types.ts:17-33
export interface DdlColumnRenderContext {
  readonly nativeType: string;
}

export interface DdlColumnDefaultVisitor<R> {
  literal(node: LiteralColumnDefault, ctx: DdlColumnRenderContext): R;
  function(node: FunctionColumnDefault, ctx: DdlColumnRenderContext): R;
}

export abstract class DdlColumnDefault {
  abstract readonly kind: string;
  abstract accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R;

  protected freeze(): void {
    Object.freeze(this);
  }
}
```

```ts
// RC/ast/ddl-types.ts:53-68
export class FunctionColumnDefault extends DdlColumnDefault {
  readonly kind = 'function' as const;
  readonly expression: string;

  constructor(expression: string) {
    super();
    this.expression = expression;
    this.freeze();
  }

  override accept<R>(visitor: DdlColumnDefaultVisitor<R>, ctx: DdlColumnRenderContext): R {
    return visitor.function(this, ctx);
  }
}

export type AnyDdlColumnDefault = LiteralColumnDefault | FunctionColumnDefault;
```

Facts about `DdlColumnDefaultVisitor`:

- No production renderer calls `accept` on a column default. Both adapters branch on `def.kind === 'function'` (`PGA/core/control-adapter.ts:1848`, `SLA/core/control-adapter.ts:745`). The only caller of `accept` is a unit test (`packages/2-sql/4-lanes/relational-core/test/contract-free/column.test.ts:43-52`).
- `FunctionColumnDefault.expression` carries four different kinds of text: a user raw-SQL body or Prisma function (`now()`, `autoincrement()`) from the contract, a planner-generated `nextval('…'::regclass)` for a sequence default (`PGT/core/migrations/op-factory-call.ts:148-151`), a planner-generated temporary backfill value such as `''`, `0`, `'{}'::jsonb` (`PGT/core/migrations/planner-recipes.ts:58-65`), and control-table defaults (`PGT/contract-free/control-bootstrap.ts:12,20,39` use `fn('now()')`; `SLT/contract-free/control-bootstrap.ts:12,22` use `fn("datetime('now')")` and `fn("strftime('%Y-%m-%dT%H:%M:%fZ','now')")`).

`DdlColumn` (`RC/ast/ddl-types.ts:70-95`) holds `readonly default?: AnyDdlColumnDefault | undefined` and calls `Object.freeze(this)` directly.

`DdlNode` base (`RC/ast/ddl-types.ts:97-117`):

```ts
export abstract class DdlNode {
  abstract readonly kind: string;
  isDdlNode(): true {
    return true;
  }
  protected freeze(): void {
    Object.freeze(this);
  }
  collectParamRefs(): AnyParamRef[] {
    return [];
  }
}
```

`isDdlNode(value)` (`:119-126`) checks the structural brand. Both control adapters use it to route DDL to their DDL walker.

Table constraints are four plain frozen classes with a `kind` string and no shared base class and no visitor (`RC/ast/ddl-types.ts:139-229`). Adapters dispatch with `if (constraint.kind === …)`. The CHECK class:

```ts
// RC/ast/ddl-types.ts:213-229
export class CheckExpressionConstraint {
  readonly kind = 'check-expression' as const;
  readonly name: string;
  readonly expression: string;

  constructor(options: { readonly name: string; readonly expression: string }) {
    this.name = options.name;
    this.expression = options.expression;
    Object.freeze(this);
  }
}

export type DdlTableConstraint =
  | PrimaryKeyConstraint
  | ForeignKeyConstraint
  | UniqueConstraint
  | CheckExpressionConstraint;
```

`CheckExpressionConstraint.expression` also carries target-generated predicates, not only `@@check` bodies: enum membership (`"kind" IN ('admin', 'user')`) and list element-non-null (`array_position(col, NULL) IS NULL`), produced by `postgresRenderCheckExpressions` (`PGT/core/check-expressions.ts`) and stored in the contract's checks.

Contract-free builders that users call from `migration.ts` (`RC/contract-free/column.ts`):

```ts
// :26-28
export function fn(expression: string): FunctionColumnDefault {
  return new FunctionColumnDefault(expression);
}
// :61-63
export function checkExpression(name: string, expression: string): CheckExpressionConstraint {
  return new CheckExpressionConstraint({ name, expression });
}
```

These are re-exported to migration files through the Postgres facade `PGT/exports/migration.ts` (`checkExpression, col, fn, foreignKey, lit, primaryKey, unique` from `@internal/sql-relational-core/contract-free`). The facade does not export any `sql` tag.

### 1.2 Postgres DDL nodes: `PGT/core/ddl/nodes.ts`

Visitor and base (`:67-84`):

```ts
export interface PostgresDdlVisitor<R> {
  createTable(node: PostgresCreateTable): R;
  createSchema(node: PostgresCreateSchema): R;
  createType(node: PostgresCreateType): R;
  dropType(node: PostgresDropType): R;
  alterTable(node: PostgresAlterTable): R;
  createPolicy(node: PostgresCreatePolicy): R;
  dropPolicy(node: PostgresDropPolicy): R;
  alterPolicyRename(node: PostgresAlterPolicyRename): R;
  createIndex(node: PostgresCreateIndex): R;
  dropIndex(node: PostgresDropIndex): R;
  alterIndexRename(node: PostgresAlterIndexRename): R;
  disableRowLevelSecurity(node: PostgresDisableRowLevelSecurity): R;
}

export abstract class PostgresDdlNode extends DdlNode {
  abstract accept<R>(visitor: PostgresDdlVisitor<R>): R;
}
```

ALTER TABLE sub-actions have their own visitor (`AlterTableActionVisitor`, `:12-15`); only `AddColumnAction` (holds a `DdlColumn`) and `DropDefaultAction` exist (`:22-61`). The comment at `:52-60` says SetDefault, SetNotNull, DropNotNull and AlterColumnType are still raw SQL in `operations/columns.ts`.

Policy node (`:207-243`):

```ts
export class PostgresCreatePolicy extends PostgresDdlNode {
  readonly kind = 'create-policy' as const;
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly permissive: boolean;
  readonly operation: RlsPolicyOperation;
  readonly roles: ReadonlyArray<string>;
  readonly using: string | undefined;
  readonly withCheck: string | undefined;

  constructor(options: {
    readonly schema: string;
    readonly table: string;
    readonly name: string;
    readonly permissive: boolean;
    readonly operation: RlsPolicyOperation;
    readonly roles: readonly string[];
    readonly using?: string;
    readonly withCheck?: string;
  }) {
    super();
    // … assigns fields …
    this.roles = Object.freeze([...options.roles]);
    this.using = options.using;
    this.withCheck = options.withCheck;
    this.freeze();
  }
  override accept<R>(visitor: PostgresDdlVisitor<R>): R {
    return visitor.createPolicy(this);
  }
}
```

Index node (`:290-344`):

```ts
/**
 * The element list between the parens of CREATE INDEX: either a column
 * tuple (each identifier quoted by the renderer) or one opaque expression
 * string covering the entire list, inserted verbatim — the same opaque-SQL
 * stance as RLS policy predicates (ADR 234).
 */
export type DdlIndexElements =
  | { readonly columns: readonly string[] }
  | { readonly expression: string };

export class PostgresCreateIndex extends PostgresDdlNode {
  readonly kind = 'create-index' as const;
  readonly schema: string | undefined;
  readonly table: string;
  readonly name: string;
  readonly unique: boolean;
  readonly elements: DdlIndexElements;
  readonly type: string | undefined;
  readonly options: Record<string, unknown> | undefined;
  /** Partial-index predicate (WHERE body, without the keyword). Inserted verbatim, never quoted or escaped. */
  readonly where: string | undefined;
  constructor(options: { … readonly where: string | undefined; }) {
    super();
    // …
    this.elements =
      'columns' in options.elements
        ? { columns: Object.freeze([...options.elements.columns]) }
        : { expression: options.elements.expression };
    // …
    this.where = options.where;
    this.freeze();
  }
}
```

Important fact for "enclose safely": `elements.expression` is the whole element list, not one expression. Committed and test values include `lower(email), id` (`packages/3-targets/3-targets/postgres/test/migrations/index-ddl.test.ts:53`). The renderer places it directly between the list parentheses, so adding another pair of parentheses around it would turn a two-element list into a row constructor.

`PostgresCreateTable` (`:96-123`) and `PostgresAlterTable` (`:182-203`) carry `DdlColumn`s and `DdlTableConstraint`s; they hold no raw SQL fields of their own. `CreateIndexElements` in `PGT/core/migrations/operations/indexes.ts:46-48` duplicates `DdlIndexElements`.

Contract-free factories (`PGT/contract-free/ddl.ts`): `createPolicy(options: { …; readonly using?: string; readonly withCheck?: string })` (`:118-129`, doc says "emitted verbatim as predicate SQL"), `createIndex(options: { …; readonly elements: DdlIndexElements; …; readonly where: string | undefined })` (`:163-174`), `addColumnAction(column: DdlColumn)` (`:87-89`), `createTable(…)` (`:36-44`).

Freeze conventions in this file: every node calls `this.freeze()` (inherited from `DdlNode`) at the end of its constructor; array fields are copied with `Object.freeze([...x])`; `AlterTableAction` subclasses call `Object.freeze(this)` directly.

### 1.3 SQLite DDL nodes: `SLT/core/ddl/nodes.ts`

One node only:

```ts
// SLT/core/ddl/nodes.ts:7-13, 25-54
export interface SqliteDdlVisitor<R> {
  createTable(node: SqliteCreateTable): R;
}
export abstract class SqliteDdlNode extends DdlNode {
  abstract accept<R>(visitor: SqliteDdlVisitor<R>): R;
}
export class SqliteCreateTable extends SqliteDdlNode { … columns: ReadonlyArray<DdlColumn>; constraints: ReadonlyArray<DdlTableConstraint> | undefined; … }
export type AnySqliteDdlNode = SqliteCreateTable;
```

The adapter does not use the visitor: `sqliteRenderDdlExecuteRequest` blind-casts to `SqliteCreateTable` (`SLA/core/control-adapter.ts:827`).

SQLite also carries raw default SQL outside DDL nodes, as a pre-rendered clause string:

```ts
// SLT/core/migrations/operations/shared.ts:37-43
export interface SqliteColumnSpec {
  readonly name: string;
  readonly typeSql: string;
  readonly defaultSql: string;   // the full `DEFAULT …` clause, or ''
  readonly nullable: boolean;
  readonly inlineAutoincrementPrimaryKey?: boolean;
}
```

### 1.4 Schema-IR and contract-IR nodes carrying the same strings

All are plain `string` fields; none are DDL nodes. They feed the DDL.

| Node | Field(s) | Location |
|---|---|---|
| Contract `Index` | `expression?`, `where?` | `packages/2-sql/1-core/contract/src/ir/sql-index.ts:69-70` |
| Contract `CheckConstraint` | `expression` | `packages/2-sql/1-core/contract/src/ir/check-constraint.ts:34` |
| Contract `PostgresRlsPolicy` | `using?`, `withCheck?` | `PGT/core/postgres-rls-policy.ts:60-61` (frozen with `freezeNode(this)`, `:75`) |
| Contract `ColumnDefault` | `{ kind: 'function'; expression: string }` | `packages/1-framework/0-foundation/contract/src/types.ts:128-133` |
| Schema IR `SqlIndexIR` | `expression?`, `where?` | `packages/2-sql/1-core/schema-ir/src/ir/sql-index-ir.ts:97-98` |
| Schema IR `SqlCheckConstraintIR` | `expression` | `packages/2-sql/1-core/schema-ir/src/ir/sql-check-constraint-ir.ts:42` |
| Schema IR `PostgresPolicySchemaNode` | `using?`, `withCheck?` | `PGT/core/schema-ir/postgres-policy-schema-node.ts:60-61` |

`SqlCheckConstraintIR` doc (`:30-35`): a wire-named check compares by id only; an exact-named check byte-compares `expression`. So the schema IR must keep the string for comparison.

The Postgres op-factory call for policies carries the contract-IR `PostgresRlsPolicy` itself, not a DDL node (`PGT/core/migrations/op-factory-call.ts:1752-1767`). The planner rebuilds it from the schema node in `policyNodeToContractPolicy` (`PGT/core/migrations/planner.ts:1027-1038`).

## 2. Every site that pastes raw SQL into a statement

### 2.1 Postgres adapter DDL walker: `PGA/core/control-adapter.ts`

Entry: `lowerToExecuteRequest` (`:213-235`) routes `isDdlNode(ast)` to `pgRenderDdlExecuteRequest(ast, this.codecRegistry)` (`:217-222`). `lower()` refuses DDL with `RUNTIME.DDL_UNSUPPORTED` (`:190-196`). The walker (`:2133-2155`) dispatches through `PostgresDdlVisitor`; every result has `params: []`. The walker has no contract and no parameter map; its only context is `codecLookup`.

Column default (`:1842-1862`):

```ts
async function pgRenderDdlColumnDefault(def, nativeType, codecLookup, codecRef): Promise<string> {
  if (def.kind === 'function') {
    if (def.expression === 'autoincrement()') { /* throws unless SERIAL-family */ return ''; }
    return `DEFAULT (${def.expression})`;
  }
  // … literal branches …
}
```

No `checkSqlDefaultBody` call here.

Column assembly (`:1891-1905`): `[quoteIdentifier(name), type, DEFAULT…, 'NOT NULL', 'PRIMARY KEY'].join(' ')`.

CHECK inside CREATE TABLE (`:1931-1933`):

```ts
if (constraint.kind === 'check-expression') {
  return `CONSTRAINT ${quoteIdentifier(constraint.name)} CHECK (${constraint.expression})`;
}
```

CREATE TABLE assembly (`:1952-1957`):

```ts
const allDefs = [...columnDefs, ...constraintDefs].join(',\n  ');
return { sql: `CREATE TABLE ${ifNotExists}${tableRef} (\n  ${allDefs}\n)`, params: [] };
```

ALTER TABLE ADD COLUMN (`:1997-2011`): `ADD COLUMN ${colFragment}`; actions joined with `', '`; statement `ALTER TABLE ${tableRef} ${actionSqls.join(', ')}`.

Policy (`:2035-2048`):

```ts
let sql = `CREATE POLICY ${quoteIdentifier(node.name)} ON ${tableRef} AS ${permissiveness} FOR ${command} TO ${roles}`;
if (node.using !== undefined) {
  sql += ` USING (${node.using})`;
}
if (node.withCheck !== undefined) {
  sql += ` WITH CHECK (${node.withCheck})`;
}
```

Index (`:2089-2109`):

```ts
const elementList =
  'columns' in node.elements
    ? node.elements.columns.map(quoteIdentifier).join(', ')
    : node.elements.expression;
// …
const whereClause = node.where !== undefined ? ` WHERE (${node.where})` : '';
return {
  sql: `CREATE ${unique}INDEX ${quoteIdentifier(node.name)} ON ${pgQualify(node.schema, node.table)}${using} (${elementList})${withClause}${whereClause}`,
  params: [],
};
```

### 2.2 Postgres raw-template sites that build no DDL node

ADD CONSTRAINT CHECK for a check added to an existing table (`PGT/core/migrations/operations/constraints.ts:133-162`, template at `:157`):

```ts
`ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(constraintName)} CHECK (${expression})`
```

SET DEFAULT (`PGT/core/migrations/operations/columns.ts:208-241`, template at `:234`): `defaultSql` is a full clause string.

```ts
`ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} SET ${defaultSql}`
```

The clause comes from `buildColumnDefaultSql` (`PGT/core/migrations/planner-ddl-builders.ts:143-164`), called by `renderColumnDefaultSql` (`PGT/core/migrations/column-ddl-rendering.ts:125-136`) from the issue planner (`PGT/core/migrations/issue-planner.ts:715`):

```ts
// planner-ddl-builders.ts:154-162
case 'function': {
  if (columnDefault.expression === 'autoincrement()') {
    return '';
  }
  assertSafeDefaultExpression(columnDefault.expression);
  return `DEFAULT (${columnDefault.expression})`;
}
case 'sequence':
  return `DEFAULT nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`;
```

`assertSafeDefaultExpression` (`:34-43`) throws `CONTRACT.DEFAULT_INVALID` when `checkSqlDefaultBody` rejects the body. `checkSqlDefaultBody` (`packages/2-sql/1-core/contract/src/default-sql-body.ts:1-8`) rejects `/;|--|\/\*|\$\$|\bSELECT\b/i`. So on this path a body containing `--` is refused at plan time. The CREATE TABLE and ADD COLUMN paths do not call it: `renderColumnDdl` (`column-ddl-rendering.ts:79-92`) converts the default with `postgresDefaultToDdlColumnDefault` (`op-factory-call.ts:138-160`), which does no check.

ALTER COLUMN TYPE … USING (`PGT/core/migrations/operations/columns.ts:79-81, 104`):

```ts
const usingClause = options.using
  ? ` USING ${options.using}`
  : ` USING ${quoteIdentifier(columnName)}::${options.qualifiedTargetType}`;
// …
`ALTER TABLE ${qualified} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE ${options.qualifiedTargetType}${usingClause}`
```

`options.using` is never set by the planner (no `using:` in any planner call site); only a hand-written `this.alterColumnType({ …, options: { using } })` sets it.

Data-transform wrapper (`PGT/core/migrations/operations/data-transform.ts:116-146`):

```ts
sql: `SELECT EXISTS (${checkPlan.sql}) AS ok`,       // :126
sql: `SELECT NOT EXISTS (${checkPlan.sql}) AS ok`,   // :142
```

`checkPlan.sql` is already lowered from the user's query plan. The comment at `:116-121` and `projects/typed-ddl-migration-ops/slices/pg-residual-ops/spec.md` ("TML-2919 spike verdict: HALT — sanctioned remnant") record that no pre-lowering `SelectAst` is available here.

### 2.3 SQLite adapter DDL walker: `SLA/core/control-adapter.ts`

Entry `lowerToExecuteRequest` (`:166-186`); `lower()` refuses DDL (`:144-151`).

```ts
// :740-752
async function sqliteRenderDdlColumnDefault(def, codecLookup, codecRef): Promise<string> {
  if (def.kind === 'function') {
    if (def.expression === 'autoincrement()') return '';
    if (def.expression === 'now()') return "DEFAULT (datetime('now'))";
    return `DEFAULT (${def.expression})`;
  }
  // …
}
```

Column assembly (`:771-783`): order is name, type, `NOT NULL`, `PRIMARY KEY`, then `DEFAULT (…)` last. CREATE TABLE (`:823-840`) joins defs with `',\n  '` and closes with `\n)`. CHECK is refused (`:809-815`, `CONTRACT.CONSTRAINT_INVALID`).

### 2.4 SQLite raw-template sites

`buildColumnDefaultSql` (`SLT/core/migrations/planner-ddl-builders.ts:66-79`, template at `:76`) calls `assertSafeDefaultExpression` (`:35-44`, same `checkSqlDefaultBody`):

```ts
case 'function': {
  if (columnDefault.expression === 'autoincrement()') return '';
  if (columnDefault.expression === 'now()') return "DEFAULT (datetime('now'))";
  assertSafeDefaultExpression(columnDefault.expression);
  return `DEFAULT (${columnDefault.expression})`;
}
```

It feeds `SqliteColumnSpec.defaultSql` via `columnSpecFromNode` (`SLT/core/migrations/column-ddl-rendering.ts:109-120`), which is used for ADD COLUMN (`issue-planner.ts:280`) and table rebuild specs (`issue-planner.ts:133`). The typed `CREATE TABLE` path uses `ddlColumnFromNode` (`column-ddl-rendering.ts:126-146`) and `sqliteDefaultToDdlColumnDefault` (`:61-82`), which do no body check.

The string is then pasted by:

- `addColumnExecuteSql` (`SLT/core/migrations/operations/columns.ts:7-15`): `['ALTER TABLE …', 'ADD COLUMN "c" TYPE', column.defaultSql, column.nullable ? '' : 'NOT NULL'].filter(Boolean).join(' ')`.
- `renderColumnDefinition` (`SLT/core/migrations/operations/shared.ts:92-101`): name, type, `defaultSql`, then `NOT NULL`. Used by `renderCreateTableSql` (`operations/tables.ts:39-60`, joins with `',\n  '`, closes with `\n)`), which `recreateTable` uses (`operations/tables.ts:175-179`).
- The rebuild postcheck derives the expected `dflt_value` from the rendered clause: `stripOuterParens(colSpec.defaultSql.slice('DEFAULT '.length))`, then embeds it as an escaped string literal (`operations/tables.ts:338-350`). Any change to how SQLite renders `DEFAULT (…)` changes this postcheck's expected text.

SQLite indexes: `buildCreateIndexSql(tableName, indexName, columns, unique)` (`planner-ddl-builders.ts:100-108`) takes columns only. The planner calls `new CreateIndexCall(table.name, indexName, index.columns ?? [])` (`SLT/core/migrations/issue-planner.ts:221` and `:322`), so a contract index `where` or `expression` is dropped without an error on SQLite.

SQLite CHECK refusals: `SLT/core/migrations/column-ddl-rendering.ts:169-175`, `SLT/core/migrations/op-factory-call.ts:103-108` (TypeScript renderer), `SLA/core/control-adapter.ts:809-815`. The PSL refusal is `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1099-1102` (capability `sql.checkConstraint`).

SQLite data transform (`SLT/core/migrations/operations/data-transform.ts:40-51`) runs the user's SQL string as a whole statement; nothing wraps it.

### 2.5 Sites checked and not found

- Generated columns: none. `GENERATED` appears only in infer comments (`PGT/core/psl-infer/infer-model-blocks.ts:360`) and identity introspection (`PGA/core/control-adapter.ts:1092`).
- Pre- and postchecks on Postgres never embed contract SQL; they use catalog names as parameters (`PGT/contract-free/checks.ts`). Introspection reads `pg_get_expr(ix.indpred, …)` and `pg_get_expr(c.conbin, …)` (`PGA/core/control-adapter.ts:953, 1001`).
- Full-text index: `@@fullTextIndex` and `fullTextIndex()` produce an ordinary contract `Index` with a planner-generated `expression` (`renderFullTextIndexExpression`, `PGT/core/full-text-index-expression.ts`) and the user's `where` (`PGT/core/authoring.ts:743, 847`; `packages/3-extensions/postgres/src/contract/full-text-index.ts:88`). They flow through the same `PostgresCreateIndex.where`; there is no separate renderer.

## 3. The query AST's `RawExpr` and `RawQueryAst`

### 3.1 Definitions (`RC/ast/types.ts`)

```ts
// :325-331
abstract class AstNode {
  abstract readonly kind: string;
  protected freeze(): void {
    Object.freeze(this);
  }
}
// :343-371 (abridged)
abstract class Expression extends AstNode implements ExpressionSource {
  abstract accept<R>(visitor: ExprVisitor<R>): R;
  abstract rewrite(rewriter: ExpressionRewriter): AnyExpression;
  abstract fold<T>(folder: ExpressionFolder<T>): T;
  collectColumnRefs(): ColumnRef[] { … }
  collectParamRefs(): AnyParamRef[] { … }
  baseColumnRef(): ColumnRef { throw … }
  toExpr(): AnyExpression { … }
  not(): NotExpr { … }
}
// :767-801
export class RawExpr extends Expression {
  readonly kind = 'raw-expr' as const;
  readonly parts: ReadonlyArray<string | AnyExpression>;
  readonly returns: ParamSpec;

  constructor(options: {
    readonly parts: ReadonlyArray<string | AnyExpression>;
    readonly returns: ParamSpec;
  }) {
    super();
    this.parts = frozenArrayCopy(options.parts);
    this.returns = options.returns;
    this.freeze();
  }
  override accept<R>(visitor: ExprVisitor<R>): R { return visitor.rawExpr(this); }
  override rewrite(rewriter: ExpressionRewriter): AnyExpression { return rewriter.rawExpr ? rewriter.rawExpr(this) : this; }
  override fold<T>(folder: ExpressionFolder<T>): T { … }
}
```

`ParamSpec` (`packages/1-framework/1-core/operations/src/index.ts:3-7`):

```ts
export interface ParamSpec {
  readonly codecId?: string;
  readonly traits?: readonly string[];
  readonly nullable: boolean;
}
```

So `returns` is required, but only `nullable` is required inside it.

`RawQueryAst` (`:2196-2255`) is a whole statement with the same `parts` shape plus a declared `result` (`rows` with column codecs, or `affected-count`), and overrides `collectParamRefs` to walk its parts. `RawExpr` is a member of `AnyExpression` (`:2259-2281`) and of `AnyInsertValue` (`:2284`).

Construction sites of `RawExpr` today: `NOW = new RawExpr({ parts: ['now()'], returns: { codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID, nullable: false } })` (`PGA/core/marker-ledger.ts:89-92`; SQLite twin `SLA/core/marker-ledger.ts:61`), `cfExpr.raw(sql, returns)` (`RC/contract-free/table.ts:129-136`), and the query-lane raw template tag `createRawSql(…)(strings, …values).returns(spec)` (`RC/expression.ts:407-446`), which turns interpolated values into `ParamRef`s.

### 3.2 How the adapters render it

Postgres (`PGA/core/sql-renderer.ts`):

```ts
// :658, :711-712 (inside renderExpr)
function renderExpr(expr: AnyExpression, contract: PostgresContract, pim: ParamIndexMap): string {
  // …
    case 'raw-expr':
      return renderRawExpr(node, contract, pim);
// :1012-1024
function renderParts(parts: RawExpr['parts'] | RawQueryAst['parts'], contract: PostgresContract, pim: ParamIndexMap): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : renderExpr(part, contract, pim)))
    .join('');
}
function renderRawExpr(node: RawExpr, contract: PostgresContract, pim: ParamIndexMap): string {
  return renderParts(node.parts, contract, pim);
}
```

`RawQueryAst` renders with the same `renderParts` (`:182-183`). `ParamIndexMap` (`:142-145`) holds `indexMap: Map<AnyParamRef, number>` and the codec descriptor registry; it is built in `renderLoweredSql` (`:152-165`), the only exported function in the file. A `ParamRef` part renders as `$N` (possibly with a `::type` cast).

SQLite (`SLA/core/adapter.ts`): `renderExpr(expr, ctx)` (`:366`), `case 'raw-expr': return renderRawExpr(node, ctx)` (`:422-423`), `renderParts`/`renderRawExpr` (`:429-438`) concatenate the same way. `SqliteRenderContext` is `{ contract: SqliteContract | undefined; codecs }` (`:175-178`); a `ParamRef` renders as `?` (`:415-417`). Only `renderLoweredSql` (`:185`) is exported.

### 3.3 Facts that bear on reusing `RawExpr` in DDL nodes versus a new node

- Same package: `RawExpr` (`RC/ast/types.ts`) and the DDL types (`RC/ast/ddl-types.ts`) are both in `@internal/sql-relational-core/ast` (`RC/exports/ast.ts` re-exports both). `ddl-types.ts` already imports `AnyParamRef` from `./types`. No layering change is needed for a DDL node to hold a `RawExpr`.
- `RawExpr` requires `returns: ParamSpec`. A DDL body has no codec; `{ nullable: false }` type-checks because `codecId` is optional.
- `RawExpr.parts` may contain any `AnyExpression`, including `ParamRef`. DDL cannot bind parameters: both DDL walkers return `params: []` and have no parameter map. A DDL body built from a `sql/expression` value would be a single string part.
- Neither adapter exports a function that renders one expression. Postgres `renderExpr` needs a `PostgresContract` and a `ParamIndexMap`; the Postgres DDL walker has neither (only `codecLookup`). SQLite's context accepts `contract: undefined`, but still needs the codec registry.
- `RawExpr` rendering adds nothing around the text: no parentheses, no line break. The "enclose safely" behaviour of decision 9 would have to live in the DDL walker, whichever node type holds the text.
- `RawExpr` takes part in `ExprVisitor`, `ExpressionRewriter` and `ExpressionFolder` walks and exposes `collectColumnRefs`, `not()`, `toExpr()`. DDL nodes take part in none of these walks.
- Existing precedent for SQL text inside the query AST: `NOW` and `cfExpr.raw` wrap a fixed SQL string in `RawExpr` with a codec `returns`.
- Name clash to be aware of: the query lane already has a raw `sql` template tag that produces `RawExpr` (`createRawSql`), and the contract builder has a separate `sql` tag that produces a `ColumnDefault` (`packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts:16-49`).

## 4. ADR 195 as implemented for SQL targets

### 4.1 Shape differs from the ADR text

ADR 195 (`docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md`) describes Mongo: rendering is done by external visitors (`renderVisitor`, `renderCallVisitor`, lines 77-108, 119-121). The SQL targets instead put both renderers on each node:

```ts
// PGT/core/migrations/op-factory-call.ts:119-132
abstract class PostgresOpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(lowerer?: Lowerer): Op | Promise<Op>;
  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: POSTGRES_MIGRATION_FACADE, symbol: this.factoryName }];
  }
  protected freeze(): void {
    Object.freeze(this);
  }
}
```

`TsExpression` (`packages/1-framework/1-core/ts-render/src/ts-expression.ts:35-38`) declares `renderTypeScript(): string` and `importRequirements()`. `POSTGRES_MIGRATION_FACADE = '@internal/postgres/migration'` (`:117`); `render-typescript.ts` maps it to the application's import root. SQLite mirrors this (`SLT/core/migrations/op-factory-call.ts:45-52`).

### 4.2 Call classes, factories and TypeScript output (Postgres)

| Call class (file:line) | Raw SQL field | `toOp` delegates to | Rendered TypeScript |
|---|---|---|---|
| `CreateTableCall` (`op-factory-call.ts:232-324`) | `columns[].default.expression` (`FunctionColumnDefault`), `constraints[].expression` (`CheckExpressionConstraint`) | builds `contractFreeDdl.createTable` and lowers it (`:264-270`) | `this.createTable({ schema, table, columns: [col(…, { default: fn("…") })], constraints: [checkExpression("name", "…")] })` via `renderDdlColumnDefault` (`:166-172`) and `renderDdlConstraintAsTsCall` (`:184-205`, CHECK at `:202-203`) |
| `AddColumnCall` (`:370-437`) | `column.default.expression` | `contractFreeDdl.alterTable` + `addColumnAction` (`:395-400`) | `this.addColumn({ schema, table, column: col(…, { default: fn("…") }) })` |
| `SetDefaultCall` (`:626-687`) | `defaultSql` (full `DEFAULT (…)` clause) | `setDefault(…)` in `operations/columns.ts:208` | `this.setDefault({ …, defaultSql: "DEFAULT (…)" })` |
| `AddCheckConstraintCall` (`:1111-1155`) | `expression` ("Opaque SQL: the predicate body, rendered verbatim inside `CHECK (…)`", `:1117`) | `addCheckConstraint(…)` in `operations/constraints.ts:133` | `this.addCheckConstraint({ schema, table, constraint, expression: "…" })` (`:1148-1150`) |
| `CreateIndexCall` (`:1198-1298`) | `expression`, `where` | `createIndex(…)` in `operations/indexes.ts:50` | `this.createIndex({ schema, table, index, expression: "…", extras: { type, options, where: "…", unique: true } })` (`:1267-1293`) |
| `CreatePostgresRlsPolicyCall` (`:1752-1801`) | `policy.using`, `policy.withCheck` | `createRlsPolicy(…)` in `operations/rls.ts:28` | `this.createRlsPolicy({ schema, table, policy: { naming, tableName, namespaceId, operation, roles, using: "…", withCheck: "…", permissive } })` typed as `RenderedRlsPolicyLiteral` (`:1780-1796`) |
| `AlterColumnTypeCall` (`:489-538`) | `options.using` | `alterColumnType(…)` | `this.alterColumnType({ …, options: { …, using: "…" } })` |
| `AddNotNullColumnWithTempDefaultCall` (`:789-845`) | `temporaryDefault` | `buildAddNotNullColumnWithTemporaryDefaultOperation` (`planner-recipes.ts:37`) | `rawSql({ id, label, operationClass: "additive" })` only (`:842-844`); the rendered call carries no steps |
| `RawSqlCall` (`:1416-1437`) | whole op | returns stored op | `rawSql(<op as JSON>)` |
| `DataTransformCall` (`:1710-1750`) | none (placeholder slots) | throws `MIGRATION.UNFILLED_PLACEHOLDER` | `this.dataTransform(endContract, "…", { check: () => placeholder("…"), run: () => placeholder("…") })` |

The factory functions called by `toOp` (all `async`, all take `lowerer: ExecuteRequestLowerer`):

```ts
// PGT/core/migrations/operations/constraints.ts:133-139
export async function addCheckConstraint(schemaName: string, tableName: string, constraintName: string, expression: string, lowerer: ExecuteRequestLowerer): Promise<Op>
// PGT/core/migrations/operations/indexes.ts:29-39, 50-57
export interface CreateIndexExtras {
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  readonly where?: string;
  readonly unique?: boolean;
}
export async function createIndex(schemaName: string, tableName: string, indexName: string, elements: CreateIndexElements, lowerer: ExecuteRequestLowerer, extras?: CreateIndexExtras): Promise<Op>
// PGT/core/migrations/operations/rls.ts:28-33
export async function createRlsPolicy(schemaName: string, tableName: string, policy: PostgresRlsPolicy, lowerer: ExecuteRequestLowerer): Promise<Op>
// PGT/core/migrations/operations/columns.ts:208-215
export async function setDefault(schemaName: string, tableName: string, columnName: string, defaultSql: string, lowerer: ExecuteRequestLowerer, operationClass: 'additive' | 'widening' = 'additive'): Promise<Op>
```

The migration-file methods that a committed `migration.ts` calls are on `PostgresMigration` (`PGT/core/migrations/postgres-migration.ts`), each building the call class and calling `toOp(this.controlAdapterFor(…))`:

```ts
// :163-169
protected createTable(options: { readonly schema: string; readonly table: string; readonly ifNotExists?: boolean; readonly columns: readonly DdlColumn[]; readonly constraints?: readonly DdlTableConstraint[] })
// :235-239
protected addColumn(options: { readonly schema: string; readonly table: string; readonly column: DdlColumn })
// :283-288
protected addCheckConstraint(options: { readonly schema: string; readonly table: string; readonly constraint: string; readonly expression: string })
// :388-394
protected setDefault(options: { readonly schema: string; readonly table: string; readonly column: string; readonly defaultSql: string; readonly operationClass?: 'additive' | 'widening' })
// :414-423
protected createIndex(options: { readonly schema: string; readonly table: string; readonly index: string; readonly extras?: CreateIndexExtras } & ({ readonly columns: readonly string[]; readonly expression?: never } | { readonly expression: string; readonly columns?: never }))
// :484-488
protected createRlsPolicy(options: { readonly schema: string; readonly table: string; readonly policy: RenderedRlsPolicyLiteral })
```

`RenderedRlsPolicyLiteral` is derived from `PostgresRlsPolicyInput` (`PGT/core/postgres-rls-policy.ts:7-37`), whose `using` and `withCheck` are `string | undefined`.

Planner construction sites: `buildCreateTableCallsFromNode` puts every declared check inside `CREATE TABLE` via `contractFree.checkExpression(c.name, c.expression)` (`PGT/core/migrations/issue-planner.ts:458-460`); a missing check on an existing table becomes `new AddCheckConstraintCall(schemaName, tableName, check.name, check.expression)` (`:870`); indexes via `createIndexCallFromNode` (`:805-829`); `SetDefaultCall` from `renderColumnDefaultSql` (`:715-725`); policies in `PGT/core/migrations/planner.ts:818-822, 844-848`.

### 4.3 SQLite call classes

- `CreateTableCall` (`SLT/core/migrations/op-factory-call.ts:132-216`) renders `fn(…)` for function defaults (`renderDdlColumnDefault`, `:68-74`) and throws for a CHECK (`:103-108`).
- `AddColumnCall` (`:341-399`) carries a `SqliteColumnSpec`; `renderTypeScript` prints the spec as JSON, so `migration.ts` contains `defaultSql: "DEFAULT (…)"` (`:392-394`).
- `RecreateTableCall` (`:265-335`) prints `contractTable` (with `defaultSql` strings) and `postchecks` (with SQL strings) as JSON (`:319-323`).
- `CreateIndexCall` (`:478-535`) takes columns only.
- Migration-file methods: `SLT/core/migrations/sqlite-migration.ts:113-169` (`createTable`, `addColumn({ table, column: SqliteColumnSpec })`, `createIndex({ table, index, columns })`, `recreateTable({ …, contractTable: SqliteTableSpec, postchecks })`).

### 4.4 How strings are printed into `migration.ts`

`jsonToTsSource` (`packages/1-framework/1-core/ts-render/src/json-to-ts-source.ts:32-53`) prints a string with `tsStringLiteral` (`ts-string-literal.ts:13-17`), which is `JSON.stringify` plus escaping U+2028/U+2029. A multi-line body therefore prints as one double-quoted literal with `\n` escapes; a `--` inside it is inert TypeScript. `renderCallsToTypeScript` (`PGT/core/migrations/render-typescript.ts:61-88`) joins calls with `',\n'` and re-indents with `indent()` (`:145-151`). Committed files show single quotes (for example `'to_tsvector(\'english\', "title")'`) because the regen script runs Biome over them.

### 4.5 `ops.json` serialization

`ops.json` stores the rendered operation only: `{ id, label, operationClass, target, precheck[], execute[], postcheck[] }` where each step is `{ description, sql, params? }`. No DDL node, no call class, and no contract text is stored separately. Writers:

- `migration plan`: `plannedOps = await Promise.all(plannerResult.plan.operations)` (`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-plan.ts:150`), which runs `renderOps(calls, lowerer)` (`PGT/core/migrations/render-ops.ts:32-50`, via `planner-produced-postgres-migration.ts:70-76`); written by `writePlannedMigrationPackage` (`migration-plan.ts:194-214`) together with `migration.ts` from `plan.renderTypeScript(…)` (`:189`).
- Running `migration.ts`: `MigrationCLI.run` → `serializeMigrationToDisk` (`packages/1-framework/3-tooling/cli/src/migration-cli.ts:504-525`) → `buildMigrationArtifacts` (`packages/1-framework/3-tooling/migration/src/migration-base.ts:264-294`), which awaits `instance.operations` and writes `JSON.stringify(ops, null, 2)`.

### 4.6 Committed `migration.ts` excerpts with SQL bodies

All 79 committed `migration.ts` files outside `src/` were searched. Four contain SQL bodies:

`examples/prisma-8-demo/migrations/app/20260422T0720_initial/migration.ts:79-104`:

```ts
col('createdAt', 'timestamptz', { notNull: true, default: fn('now()') }),
// …
constraints: [
  primaryKey(['id']),
  checkExpression('user_kind_check_836d43ef', "\"kind\" IN ('admin', 'user')"),
],
// …
checkExpression('post_priority_check_b236ace9', '"priority" IN (0, 1, 2)'),
```

`examples/prisma-8-demo/migrations/app/20260917T0818_add_post_expires_at/migration.ts:18-26`:

```ts
this.addColumn({
  schema: 'public',
  table: 'post',
  column: col('expiresAt', 'timestamptz', {
    notNull: true,
    default: fn("(now() + '7 days'::interval)"),
    codecRef: { codecId: 'pg/timestamptz-temporal@1' },
  }),
}),
```

`examples/prisma-8-demo/migrations/app/20260922T1218_add_post_title_search/migration.ts:18-24`:

```ts
this.createIndex({
  schema: 'public',
  table: 'post',
  index: 'post_title_search_724b05e5',
  expression: 'to_tsvector(\'english\', "title")',
  extras: { type: 'gin' },
}),
```

`apps/telemetry-backend/migrations/app/20260520T1317_migration/migration.ts:30`: `col('ingestedAt', 'timestamptz', { notNull: true, default: fn('now()') })`.

No committed `migration.ts` calls `addCheckConstraint`, `setDefault`, `createRlsPolicy`, or `createIndex` with a `where`.

## 5. Would committed artefacts change, and what runs at apply time

### 5.1 Apply time reads JSON only

- `readMigrationPackage` (`packages/1-framework/3-tooling/migration/src/io.ts:187-266`) reads `migration.json` and `ops.json`, validates both, re-derives `providedInvariants`, and calls `verifyMigrationHash` (`hash.ts:111`), throwing on mismatch (`io.ts:256-263`).
- `computeMigrationHash` (`hash.ts:89-100`) hashes canonicalized metadata and canonicalized ops, including every `step.sql` verbatim.
- `migration.ts` is not loaded at apply time. ADR 192 line 17: "the runner reads `migration.json` and `ops.json`. It never loads `migration.ts`." ADR 192 line 60 specifies an emit-drift check that dynamic-imports `migration.ts` and compares hashes; the Migration System doc line 254 says: "*(Architecturally required; not yet implemented — tracked as a follow-up.)*". No code outside `migration-cli.ts` calls `buildMigrationArtifacts`.

### 5.2 Which committed artefacts would change

- `ops.json`: holds rendered SQL. Committed `ops.json` files with embedded bodies: `examples/prisma-8-demo/migrations/app/20260422T0720_initial/ops.json` (for example `:157`, `CONSTRAINT \"user_kind_check_836d43ef\" CHECK (\"kind\" IN ('admin', 'user'))` and `DEFAULT (now())`), `…/20260917T0818_add_post_expires_at/ops.json:25` (`DEFAULT ((now() + '7 days'::interval)) NOT NULL`), `…/20260922T1218_add_post_title_search/ops.json:25` (`USING \"gin\" (to_tsvector('english', \"title\"))`), `apps/telemetry-backend/migrations/app/20260520T1317_migration/ops.json:24`. A search of all 82 committed `ops.json` files found none containing `--`. So if rendering stays byte-identical for bodies without a line comment, no committed `ops.json` changes, and therefore no `migrationHash` in `migration.json` changes.
- `migration.ts`: committed files call `fn(string)`, `checkExpression(string, string)`, and `this.createIndex({ expression: string })`. They change only if those public signatures change. The TypeScript renderer prints `FunctionColumnDefault.expression` and `CheckExpressionConstraint.expression` by reading the string field (`op-factory-call.ts:171, 203`; `SLT/…/op-factory-call.ts:73`).
- Regeneration: `pnpm fixtures:emit` runs `scripts/regen-example-migrations.mjs` and `scripts/regen-extension-migrations.mjs` (`package.json:57-59`). The example script re-runs each `migration.ts` with `tsx` to rewrite `ops.json` and `migration.json` (script header, step 4). `fixtures:check` (`package.json:60`) diffs only `**/contract.*` and `**/expected.contract.json`, so an `ops.json` change would show in `git status` but would not fail `fixtures:check`.
- Round-trip guarantee: `render-typescript.roundtrip.test.ts` (Postgres, `packages/3-targets/6-adapters/postgres/test/migrations/…:222-287`) renders calls to TypeScript, runs the file, and asserts the written `ops.json` equals `renderOps(calls)`. Its call list includes `CreateIndexCall` with `expression` and `where`, and `CreatePostgresRlsPolicyCall` with `using` and `withCheck`; it has no `AddCheckConstraintCall`, no `checkExpression`, no `fn` default.

## 6. Where a trailing `--` comment breaks the rendered SQL today

The canonical body of a `sql` literal has lines joined with `\n` and no trailing newline (`canonicalizeTaggedLiteralBody`, `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts:66-96`). So text after the body on the same output line is inside the comment. Each runner step is sent as one statement (`driver.query(step.sql, step.params ?? [])`, `PGT/core/migrations/runner.ts:374`).

| Site | Template | What follows the body on the same line | Breaks? |
|---|---|---|---|
| PG CHECK in CREATE TABLE | `PGA/…/control-adapter.ts:1932` | `)` of CHECK, then `,` separator (next def starts after `\n`) | Yes |
| PG ADD CONSTRAINT CHECK | `PGT/…/operations/constraints.ts:157` | `)` | Yes |
| PG policy USING | `PGA/…/control-adapter.ts:2042` | `)`, then ` WITH CHECK (…)` if present | Yes |
| PG policy WITH CHECK | `PGA/…/control-adapter.ts:2045` | `)` | Yes |
| PG index expression list | `PGA/…/control-adapter.ts:2093, 2106` | `)` of the element list, then ` WITH (…)` and ` WHERE (…)` | Yes |
| PG index WHERE (also `@@fullTextIndex(where:)`) | `PGA/…/control-adapter.ts:2104` | `)` | Yes |
| PG DEFAULT in CREATE TABLE / ADD COLUMN | `PGA/…/control-adapter.ts:1861` | `)`, then ` NOT NULL`, ` PRIMARY KEY`, and `,` (CREATE TABLE) or `, <next action>` (ALTER TABLE) | Yes |
| PG SET DEFAULT | `PGT/…/planner-ddl-builders.ts:159` → `operations/columns.ts:234` | `)` | Yes, but `assertSafeDefaultExpression` refuses `--` first |
| PG ALTER COLUMN TYPE USING | `PGT/…/operations/columns.ts:80` | nothing (end of statement, no parenthesis) | No |
| PG data-transform wrapper | `PGT/…/operations/data-transform.ts:126, 142` | `) AS ok` | Yes, if the lowered query text ends in a line comment |
| SQLite DEFAULT in CREATE TABLE (typed) | `SLA/…/control-adapter.ts:751` | `)`, then `,` or `\n)` | Yes |
| SQLite DEFAULT in ADD COLUMN / rebuild | `SLT/…/planner-ddl-builders.ts:76` → `operations/columns.ts:7-15`, `operations/shared.ts:97-98` | `)`, then ` NOT NULL`, then `,` | Yes, but `assertSafeDefaultExpression` refuses `--` first |

Default bodies written in PSL or the TypeScript builder are refused earlier when they contain `--`: PSL tag (`packages/2-sql/9-family/src/core/sql-default-literal-tag.ts:34`), TypeScript tag (`packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts:42-47`). So today a `--` default reaches rendering only through a hand-written `fn('… -- x')` in `migration.ts`.

Where parentheses are and are not part of the syntax (bears on "enclose safely"): `CHECK (…)`, `USING (…)` and `WITH CHECK (…)` require them. Index `WHERE` and `DEFAULT` do not; the renderers add them. The index expression is placed inside the element-list parentheses and may itself be a comma-separated list, so no extra parentheses can be added around it (see 1.2).

## 7. Docs and the typed-DDL project

### 7.1 `docs/architecture docs/subsystems/7. Migration System.md`

- "Planner IR" (`:117-126`) lists only the Mongo call classes and says a visitor provides dispatch. It does not describe the SQL call classes, `toOp(lowerer)`, or `TsExpression`.
- "Authoring a migration.ts" (`:173-214`) shows only a Mongo example.
- "Hash verification" (`:249-254`): on-disk hash check is implemented; emit-drift detection "not yet implemented".
- "Operation Model" → "DDL operations" (`:370-372`) describes Mongo commands only. "Data transform operations" (`:374-381`) documents the Postgres `SELECT EXISTS (<check.sql>) AS ok` wrapper. "Serialization" (`:383-386`) describes Mongo AST serialization.
- Nothing in this doc or in `5. Adapters & Targets.md` describes SQL DDL nodes, `lowerToExecuteRequest`, or how adapters render embedded SQL.

### 7.2 `projects/typed-ddl-migration-ops/`

- Purpose: every Postgres and SQLite migration op builds a typed DDL node rendered by the adapter; an ADR and subsystem-doc update (TML-2923) was planned last.
- Status: stalled. `plan.md` marks slice 1 (`pg-residual-ops`, TML-2919) as "in flight"; its merged commit is `78c39f4125` (2026-06-24). The slice left the data-transform wrapper as a "sanctioned remnant". Slices 2-5 (TML-2920 CreateExtension, TML-2921 SQLite execute steps, TML-2922 SQLite rebuild, TML-2923 ADR/docs) have no commits. The last substantive commit touching the directory is `1ce2735b6e` (2026-06-25); the latest is `ada72f1611` (2026-08-03), a repo-wide rename. None of the project-DoD boxes are ticked.
- Its spec says "21/23 ops on the typed path" for Postgres, but in code `addCheckConstraint`, `setDefault`, `alterColumnType`, `setNotNull`, `dropNotNull`, `dropColumn`, `addPrimaryKey`, `addUnique`, `addForeignKey`, `dropConstraint`, `dropCheckConstraint`, `renameCheckConstraint`, `enableRowLevelSecurity` and `dropTable` still build their execute SQL as template strings in `PGT/core/migrations/operations/*.ts`.

## 8. Tests covering these renderers and factories

No `.snap` snapshot file covers DDL. The tests below assert exact SQL strings or node fields; any of them would change if the rendered text or the node field types changed.

Postgres adapter DDL rendering (`packages/3-targets/6-adapters/postgres/test/`):

- `migrations/index-ddl-rendering.test.ts`: `CreateIndexCall` SQL; WHERE verbatim in parens (`:156-169`), expression list verbatim (`:171`), GIN over `to_tsvector` (`:180`), all clauses in order (`:193-209`).
- `ddl-rls-lowering.test.ts`: `CREATE POLICY` SQL for each command, `USING` before `WITH CHECK` (`:16-124`).
- `ddl-create-table-lowering.test.ts`: every column default shape, `DEFAULT (now())`, function defaults without cast (`:29-55`, `:205-218`).
- `ddl-add-column-lowering.test.ts`: `ALTER TABLE … ADD COLUMN … DEFAULT (now())` (`:65-75`); DDL params always empty (`:207`).
- `lower-to-execute-request.test.ts`: DDL literal and function defaults in `CREATE TABLE` (`:147-148`).
- `migrations/op-factory-call.construction.test.ts`: byte-parity of `CreateTableCall`/`AddColumnCall` SQL, including the `nextval` default (`:81-92`).
- `migrations/op-factory-call.lowering.test.ts`: `renderOps` for every variant; `AddNotNullColumnWithTempDefaultCall` exact SQL `DEFAULT ('[0,0,0]') NOT NULL` (`:272-308`).
- `migrations/op-factory-call.rendering.test.ts`: `renderTypeScript` for every call class, including `defaultSql` strings (`:58-75`), `using` in `AlterColumnTypeCall` (`:232-240`), `CreateIndexCall` extras (`:307`).
- `migrations/render-typescript.roundtrip.test.ts`: render → run `migration.ts` → `ops.json` equals `renderOps(calls)` (`:222-287`); typechecks a rendered RLS migration (`:310`).
- `migrations/planner-ddl-builders.test.ts`: `buildColumnDefaultSql` (`DEFAULT (now())`, unsafe body refused, list defaults) (`:128-239`).
- Integration (PGlite): `migrations/check-lifecycle-e2e.integration.test.ts` (checks installed by CREATE TABLE and by ALTER), `migrations/enum-check-constraint.integration.test.ts` (enum CHECK created and enforced), `migrations/rls-lifecycle-e2e.integration.test.ts` and `migrations/rls-migration-plan.integration.test.ts` (policy SQL contains `USING (…)` / `WITH CHECK (…)`, `:190-191`).

Postgres target (`packages/3-targets/3-targets/postgres/test/`):

- `migrations/index-ddl.test.ts`: `createIndex` passes `where` and `elements.expression` strings to the `PostgresCreateIndex` node (`:48-69`).
- `migrations/rls-ops.test.ts`: `createRlsPolicy` passes `using` string to `PostgresCreatePolicy` (`:109-142`); `renderTypeScript` round-trip (`:284`).
- `migrations/op-factory-call.test.ts`: `AddCheckConstraintCall` SQL contains `CHECK ("priority" IN ('low', 'high'))` and renders `this.addCheckConstraint` (`:155-179`).
- `migrations/op-factory-call.lowering.test.ts`: per-class lowering and rendering (1103 lines).
- `migrations/render-typescript.test.ts`: facade import surface; fixture uses `checkExpression(…)` and `fn('gen_random_uuid()')` (`:191-199`); every rendered symbol is exported by the facade (`:268`).
- `migrations/authored-default-rendering.test.ts`: `renderColumnDdl` default equals `{ kind: 'function', expression }` and `renderColumnDefaultSql` returns `DEFAULT (<expr>)` (`:75-95`).
- `migrations/full-text-index-planning.test.ts`: `@@fullTextIndex` and `@@index(expression:)` plan the same `CREATE INDEX` (`:150-168`).
- `errors.test.ts:98-101`: `buildColumnDefaultSql` refuses an unsafe body.
- `postgres-migration-op-builders.test.ts`: every `PostgresMigration` method lowers to an op.
- `check-expressions.integration.test.ts`: generated membership predicates run inside `CHECK (…)`.

SQLite:

- `packages/3-targets/3-targets/sqlite/test/planner-ddl-builders.test.ts`: `buildColumnDefaultSql`, including a tagged-literal body verbatim inside `DEFAULT (...)` (`:57-110`).
- `packages/3-targets/3-targets/sqlite/test/plan-diff-defaults.test.ts`: expected `DEFAULT (CURRENT_TIMESTAMP)`, `DEFAULT ('x')`, `DEFAULT (datetime('now'))` (`:86-88`).
- `packages/3-targets/3-targets/sqlite/test/structured-errors.test.ts:104, 130-134`: unsafe default refused; CHECK constraint refused.
- `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-lowering.test.ts`: `CreateTableCall` SQL, including `DEFAULT (datetime('now'))` (`:260`).
- `packages/3-targets/6-adapters/sqlite/test/lower-to-execute-request.test.ts`: DDL default rendering.
- `packages/3-targets/6-adapters/sqlite/test/migrations/render-typescript.roundtrip.test.ts`: render → run → `ops.json` parity, including `RecreateTableCall` (`:153-251`).
- `packages/3-targets/6-adapters/sqlite/test/structured-errors.test.ts:163`: `CheckExpressionConstraint` refused by the adapter.

Family and lane:

- `packages/2-sql/4-lanes/relational-core/test/contract-free/column.test.ts`: `fn` returns a frozen `FunctionColumnDefault` with `.expression` (`:22-28`); default visitor dispatch (`:43-52`).
- `packages/2-sql/4-lanes/relational-core/test/ast/ddl-node-brand.test.ts`: `isDdlNode` brand for target-contributed nodes.
- `packages/2-sql/9-family/test/sql-default-literal-tag.test.ts`: `checkSqlDefaultBody` accepts and refuses bodies.

End-to-end:

- `test/integration/test/cli-journeys/expression-index-migration.e2e.test.ts`: exact `CREATE INDEX` SQL in planned `ops.json`, including `WHERE ((archived_at IS NULL))` (`:43-48`); uses plan-and-self-emit.
- `test/e2e/framework/test/ddl.test.ts`: `DEFAULT (now()) NOT NULL` in created tables.
- `test/integration/test/cli-journeys/rls-exact-name-adoption.e2e.test.ts`, `infer-roundtrip-fidelity.hand-written-check.e2e.test.ts`, `contract-infer-workflow.e2e.test.ts`: policy and check SQL in journeys.

Ten test files build `fn(…)`, `new FunctionColumnDefault(…)` or `checkExpression(…)` values directly: `packages/2-sql/1-core/schema-ir/test/resolved-default-equality.test.ts`, `packages/2-sql/4-lanes/relational-core/test/contract-free/column.test.ts`, `packages/3-targets/3-targets/postgres/test/migrations/render-typescript.test.ts`, `packages/3-targets/3-targets/sqlite/test/contract-free/ddl.test.ts`, and in `packages/3-targets/6-adapters/`: `postgres/test/ddl-add-column-lowering.test.ts`, `postgres/test/ddl-create-table-lowering.test.ts`, `postgres/test/lower-to-execute-request.test.ts`, `postgres/test/migrations/op-factory-call.construction.test.ts`, `sqlite/test/lower-to-execute-request.test.ts`, `sqlite/test/migrations/create-table-call-lowering.test.ts`.
