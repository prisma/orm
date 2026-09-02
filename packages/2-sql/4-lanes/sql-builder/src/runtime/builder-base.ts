import type { PlanMeta } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type { AnnotationValue, OperationKind } from '@internal/framework-components/runtime';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import type { SqlOperationEntry } from '@internal/sql-operations';
import {
  AndExpr,
  type AnyExpression as AstExpression,
  collectOrderedParamRefs,
  IdentifierRef,
  type LimitOffsetValue,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type {
  AppliedMutationDefault,
  MutationDefaultsOptions,
  SqlAggregateDescriptorRegistry,
} from '@internal/sql-relational-core/query-lane-context';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type {
  AggregateFunctions,
  Expression,
  FieldProxy,
  OrderByOptions,
  OrderByScope,
} from '../expression';
import type {
  GatedMethod,
  MergeScopes,
  NullableScope,
  QueryContext,
  Scope,
  ScopeField,
  ScopeTable,
} from '../scope';
import { projectionAstOf } from './expression-impl';
import { createFieldProxy } from './field-proxy';
import { createAggregateFunctions, createFunctions } from './functions';

export type ExprCallback = (fields: FieldProxy<Scope>, fns: unknown) => Expression<ScopeField>;

export class BuilderBase<Capabilities = unknown> {
  protected readonly ctx: BuilderContext;

  constructor(ctx: BuilderContext) {
    this.ctx = ctx;
  }

  protected _gate<Req extends Record<string, Record<string, boolean>>, Args extends unknown[], R>(
    required: Req,
    methodName: string,
    method: (...args: Args) => R,
  ): GatedMethod<Capabilities, Req, (...args: Args) => R> {
    return ((...args: Args): R => {
      assertCapability(this.ctx, required, methodName);
      return method(...args);
    }) as GatedMethod<Capabilities, Req, (...args: Args) => R>;
  }
}

export interface BuilderState {
  readonly from: TableSource;
  readonly joins: readonly import('@internal/sql-relational-core/ast').JoinAst[];
  readonly projections: readonly ProjectionItem[];
  readonly where: readonly AstExpression[];
  readonly orderBy: readonly OrderByItem[];
  readonly groupBy: readonly AstExpression[];
  readonly having: AstExpression | undefined;
  readonly limit: LimitOffsetValue | undefined;
  readonly offset: LimitOffsetValue | undefined;
  readonly distinct: true | undefined;
  readonly distinctOn: readonly AstExpression[] | undefined;
  readonly scope: Scope;
  readonly rowFields: Record<string, ScopeField>;
  /**
   * Annotations accumulated through `.annotate(...)` calls. Stored as
   * a `Map<namespace, AnnotationValue>` so duplicate namespaces
   * last-write-win. Empty on a fresh state.
   */
  readonly annotations: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>;
}

export interface BuilderContext {
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly queryOperationTypes: Readonly<Record<string, SqlOperationEntry>>;
  readonly target: string;
  readonly storageHash: string;
  /**
   * Contract storage carried by the builder context so column-bound `ParamRef` / `ProjectionItem` construction sites can derive a {@link CodecRef} for each `(table, column)` via {@link codecRefFor}. Builder paths that mint AST nodes without storage (rare — tests, ad-hoc lower paths) leave it undefined; the codec slot then stays `undefined` on the resulting nodes.
   */
  readonly storage: SqlStorage | undefined;
  readonly applyMutationDefaults: (
    options: MutationDefaultsOptions,
  ) => ReadonlyArray<AppliedMutationDefault>;
  /**
   * Codec inferer used inside `createBuiltinFunctions` to construct the raw-SQL tag — `fns.raw` dispatches through `inferCodec(value)` for bare-literal interpolations.
   */
  readonly rawCodecInferer: RawCodecInferer;
  /**
   * Aggregate result identity, resolved from the descriptors the composed stack contributes. The lane asks it what an aggregate's result carries rather than assuming the input's codec or naming a target's codec id.
   */
  readonly aggregates: SqlAggregateDescriptorRegistry;
}

/**
 * Derive the canonical {@link CodecRef} for a `(table, column)` from the builder context's storage. Returns `undefined` when the builder context has no storage attached or when the column is unknown to the contract.
 */
export function codecRefFor(
  ctx: BuilderContext,
  namespaceId: string,
  tableName: string,
  columnName: string,
): CodecRef | undefined {
  if (!ctx.storage) return undefined;
  return codecRefForStorageColumn(ctx.storage, namespaceId, tableName, columnName);
}

export function emptyState(from: TableSource, scope: Scope): BuilderState {
  return {
    from,
    joins: [],
    projections: [],
    where: [],
    orderBy: [],
    groupBy: [],
    having: undefined,
    limit: undefined,
    offset: undefined,
    distinct: undefined,
    distinctOn: undefined,
    scope,
    rowFields: {},
    annotations: new Map(),
  };
}

export function cloneState(state: BuilderState, overrides: Partial<BuilderState>): BuilderState {
  return { ...state, ...overrides };
}

export function combineWhereExprs(exprs: readonly AstExpression[]): AstExpression | undefined {
  if (exprs.length === 0) return undefined;
  if (exprs.length === 1) return exprs[0];
  return AndExpr.of(exprs);
}

export function buildSelectAst(state: BuilderState): SelectAst {
  const where = combineWhereExprs(state.where);
  return new SelectAst({
    from: state.from,
    joins: state.joins.length > 0 ? state.joins : undefined,
    projection: state.projections,
    where,
    orderBy: state.orderBy.length > 0 ? state.orderBy : undefined,
    distinct: state.distinct,
    distinctOn: state.distinctOn && state.distinctOn.length > 0 ? state.distinctOn : undefined,
    groupBy: state.groupBy.length > 0 ? state.groupBy : undefined,
    having: state.having,
    limit: state.limit,
    offset: state.offset,
    selectAllIntent: undefined,
  });
}

export function buildQueryPlan<Row = unknown>(
  ast: import('@internal/sql-relational-core/ast').AnyQueryAst,
  ctx: BuilderContext,
  annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>>,
): SqlQueryPlan<Row> {
  const paramValues = collectOrderedParamRefs(ast).map((r) =>
    r.kind === 'param-ref' ? r.value : undefined,
  );

  // SQL DSL has no framework-reserved namespace keys (e.g. `codecs`) in
  // scope at `.build()` time, so user annotations land verbatim here. The
  // ORM dispatch path — which compiles to plans that may already carry
  // reserved keys — enforces the precedence rule in `mergeAnnotations`
  // (`sql-orm-client/src/query-plan-meta.ts`).
  const annotationsRecord =
    annotations !== undefined && annotations.size > 0
      ? Object.freeze(Object.fromEntries(annotations))
      : undefined;
  const meta: PlanMeta = Object.freeze({
    target: ctx.target,
    storageHash: ctx.storageHash,
    lane: 'dsl',
    ...ifDefined('annotations', annotationsRecord),
  });

  return Object.freeze({ ast, params: paramValues, meta });
}

export function buildPlan<Row = unknown>(
  state: BuilderState,
  ctx: BuilderContext,
): SqlQueryPlan<Row> {
  return buildQueryPlan<Row>(buildSelectAst(state), ctx, state.annotations);
}

export function tableToScope(
  alias: string,
  table: StorageTable,
  options?: {
    readonly storage?: SqlStorage | undefined;
    readonly namespaceId?: string | undefined;
    readonly tableName?: string | undefined;
  },
): Scope {
  const storage = options?.storage;
  const lookupName = options?.tableName;
  const namespaceId = options?.namespaceId;
  const fields: ScopeTable = {};
  for (const [colName, col] of Object.entries(table.columns)) {
    const codec =
      storage && lookupName && namespaceId !== undefined
        ? codecRefForStorageColumn(storage, namespaceId, lookupName, colName)
        : undefined;
    fields[colName] = {
      codecId: col.codecId,
      nullable: col.nullable,
      ...(col.many ? { many: true as const } : {}),
      ...(codec !== undefined ? { codec } : {}),
    };
  }
  return { topLevel: { ...fields }, namespaces: { [alias]: fields } };
}

export function mergeScopes<A extends Scope, B extends Scope>(a: A, b: B): MergeScopes<A, B> {
  const topLevel: ScopeTable = {};
  for (const [k, v] of Object.entries(a.topLevel)) {
    if (!(k in b.topLevel)) topLevel[k] = v;
  }
  for (const [k, v] of Object.entries(b.topLevel)) {
    if (!(k in a.topLevel)) topLevel[k] = v;
  }
  return {
    topLevel,
    namespaces: { ...a.namespaces, ...b.namespaces },
  } as MergeScopes<A, B>;
}

export function nullableScope<S extends Scope>(scope: S): NullableScope<S> {
  const mkNullable = (tbl: ScopeTable): ScopeTable => {
    const result: ScopeTable = {};
    for (const [k, v] of Object.entries(tbl)) {
      result[k] = {
        codecId: v.codecId,
        nullable: true,
        ...(v.codec !== undefined ? { codec: v.codec } : {}),
      };
    }
    return result;
  };
  const namespaces: Record<string, ScopeTable> = {};
  for (const [k, v] of Object.entries(scope.namespaces)) {
    namespaces[k] = mkNullable(v);
  }
  return { topLevel: mkNullable(scope.topLevel), namespaces } as NullableScope<S>;
}

export function orderByScopeOf<S extends Scope, R extends Record<string, ScopeField>>(
  scope: S,
  rowFields: R,
): OrderByScope<S, R> {
  return {
    topLevel: { ...scope.topLevel, ...rowFields },
    namespaces: scope.namespaces,
  };
}

export function assertCapability(
  ctx: BuilderContext,
  required: Record<string, Record<string, boolean>>,
  methodName: string,
): void {
  for (const [ns, keys] of Object.entries(required)) {
    for (const key of Object.keys(keys)) {
      if (!ctx.capabilities[ns]?.[key]) {
        throw structuredError(
          'ORM.CAPABILITY_MISSING',
          `${methodName}() requires capability ${ns}.${key}`,
          { meta: { method: methodName, capability: `${ns}.${key}` } },
        );
      }
    }
  }
}

export function resolveSelectArgs(
  args: unknown[],
  scope: Scope,
  ctx: BuilderContext,
): { projections: ProjectionItem[]; newRowFields: Record<string, ScopeField> } {
  const projections: ProjectionItem[] = [];
  const newRowFields: Record<string, ScopeField> = {};

  if (args.length === 0) return { projections, newRowFields };

  if (typeof args[0] === 'string' && (args.length === 1 || typeof args[1] !== 'function')) {
    for (const colName of args as string[]) {
      const field = scope.topLevel[colName];
      if (!field)
        throw structuredError('ORM.COLUMN_UNKNOWN', `Column "${colName}" not found in scope`, {
          meta: { column: colName },
        });
      projections.push(ProjectionItem.of(colName, IdentifierRef.of(colName), field.codec));
      newRowFields[colName] = field;
    }
    return { projections, newRowFields };
  }

  if (typeof args[0] === 'string' && typeof args[1] === 'function') {
    const alias = args[0] as string;
    const exprFn = args[1] as (
      f: FieldProxy<Scope>,
      fns: AggregateFunctions<QueryContext>,
    ) => Expression<ScopeField>;
    const fns = createAggregateFunctions(
      ctx.queryOperationTypes,
      ctx.rawCodecInferer,
      ctx.aggregates,
    );
    const result = exprFn(createFieldProxy(scope), fns);
    const field = result.returnType;
    projections.push(ProjectionItem.of(alias, projectionAstOf(result), field.codec));
    newRowFields[alias] = field;
    return { projections, newRowFields };
  }

  if (typeof args[0] === 'function') {
    const callbackFn = args[0] as (
      f: FieldProxy<Scope>,
      fns: AggregateFunctions<QueryContext>,
    ) => Record<string, Expression<ScopeField>>;
    const fns = createAggregateFunctions(
      ctx.queryOperationTypes,
      ctx.rawCodecInferer,
      ctx.aggregates,
    );
    const record = callbackFn(createFieldProxy(scope), fns);
    for (const [key, expr] of Object.entries(record)) {
      const field = expr.returnType;
      projections.push(ProjectionItem.of(key, projectionAstOf(expr), field.codec));
      newRowFields[key] = field;
    }
    return { projections, newRowFields };
  }

  throw structuredError('ORM.ARGUMENT_INVALID', 'Invalid .select() arguments');
}

export function resolveOrderBy(
  arg: unknown,
  options: OrderByOptions | undefined,
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  ctx: BuilderContext,
  useAggregateFns: boolean,
): OrderByItem {
  const dir = options?.direction ?? 'asc';
  const nulls = options?.nulls;

  if (typeof arg === 'string') {
    const combined = orderByScopeOf(scope, rowFields);
    if (!(arg in combined.topLevel))
      throw structuredError(
        'ORM.COLUMN_UNKNOWN',
        `Column "${arg}" not found in scope for orderBy`,
        {
          meta: { column: arg },
        },
      );
    const expr = IdentifierRef.of(arg);
    return dir === 'asc' ? OrderByItem.asc(expr, nulls) : OrderByItem.desc(expr, nulls);
  }

  if (typeof arg === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = useAggregateFns
      ? createAggregateFunctions(ctx.queryOperationTypes, ctx.rawCodecInferer, ctx.aggregates)
      : createFunctions(ctx.queryOperationTypes, ctx.rawCodecInferer);
    const result = (arg as ExprCallback)(createFieldProxy(combined), fns);
    return dir === 'asc'
      ? OrderByItem.asc(result.buildAst(), nulls)
      : OrderByItem.desc(result.buildAst(), nulls);
  }

  throw structuredError('ORM.ARGUMENT_INVALID', 'Invalid orderBy argument');
}

export function resolveGroupBy(
  args: unknown[],
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  ctx: BuilderContext,
): AstExpression[] {
  if (typeof args[0] === 'string') {
    const combined = orderByScopeOf(scope, rowFields);
    return (args as string[]).map((colName) => {
      if (!(colName in combined.topLevel))
        throw structuredError(
          'ORM.COLUMN_UNKNOWN',
          `Column "${colName}" not found in scope for groupBy`,
          { meta: { column: colName } },
        );
      return IdentifierRef.of(colName);
    });
  }

  if (typeof args[0] === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = createFunctions(ctx.queryOperationTypes, ctx.rawCodecInferer);
    const result = (args[0] as ExprCallback)(createFieldProxy(combined), fns);
    return [result.buildAst()];
  }

  throw structuredError('ORM.ARGUMENT_INVALID', 'Invalid groupBy arguments');
}

export function resolveDistinctOn(
  args: unknown[],
  scope: Scope,
  rowFields: Record<string, ScopeField>,
  ctx: BuilderContext,
): AstExpression[] {
  if (args.length === 1 && typeof args[0] === 'function') {
    const combined = orderByScopeOf(scope, rowFields);
    const fns = createFunctions(ctx.queryOperationTypes, ctx.rawCodecInferer);
    const result = (args[0] as ExprCallback)(createFieldProxy(combined), fns);
    return [result.buildAst()];
  }
  const combined = orderByScopeOf(scope, rowFields);
  return (args as string[]).map((colName) => {
    if (!(colName in combined.topLevel))
      throw structuredError(
        'ORM.COLUMN_UNKNOWN',
        `Column "${colName}" not found in scope for distinctOn`,
        { meta: { column: colName } },
      );
    return IdentifierRef.of(colName);
  });
}
