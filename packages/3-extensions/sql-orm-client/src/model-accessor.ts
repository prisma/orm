import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlOperationEntry } from '@internal/sql-operations';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type CodecRef,
  ExistsExpr,
  JoinAst,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { Expression, ScopeField } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { plainAggregateExpr } from './aggregate-codecs';
import {
  addressedModelName,
  columnOfCallerField,
  columnOfContractField,
  type FieldColumn,
  getModelAndVariantFieldColumns,
  getModelFieldColumns,
  isToOneCardinality,
  resolveModelRelations,
  resolveModelTableName,
  resolveRelationTargetColumns,
  resolveVariantFieldColumns,
} from './collection-contract';
import { assertModelFieldNames } from './collection-runtime';
import type { CollectionTables } from './collection-tables';
import { codecTraits, hasTrait, resolveColumn } from './column-codec';
import { and, not } from './filters';
import { checkedOrderByItem } from './order-by-guards';
import { ormError } from './orm-errors';
import type { AliasedTable, TableScope } from './table-scope';
import {
  COMPARISON_METHODS_META,
  type ComparisonMethodFns,
  type ModelAccessor,
  type Orderable,
  type OrderOptions,
  type RelationFilterAccessor,
  type VariantAwareModelAccessor,
} from './types';

type ResolvedModelRelation = ReturnType<typeof resolveModelRelations>[string];
type ResolvedModelRelationWithThrough = ResolvedModelRelation & {
  through: NonNullable<ResolvedModelRelation['through']>;
};

function hasThrough(relation: ResolvedModelRelation): relation is ResolvedModelRelationWithThrough {
  return relation.through !== undefined;
}

type RelationPredicateInput<
  TContract extends Contract<SqlStorage>,
  NsId extends string,
  ModelName extends string,
> = ((model: ModelAccessor<TContract, ModelName, NsId>) => AnyExpression) | Record<string, unknown>;

type RelationFilterMode = 'some' | 'every' | 'none';
type RelationFilterPlan =
  | { readonly kind: 'constantTrue' }
  | { readonly kind: 'exists'; readonly notExists: boolean; readonly where: AnyExpression };

type NamedOp = readonly [name: string, entry: SqlOperationEntry];

export function createModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName extends string | undefined = undefined,
  NsId extends string = string,
>(
  context: ExecutionContext<TContract>,
  namespaceId: NsId,
  modelName: ModelName,
  tables: CollectionTables,
  variantName?: VariantName,
): VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId> {
  return createModelAccessorInScope(
    context,
    namespaceId,
    modelName,
    variantName,
    tables.scope,
    tables.root,
    variantName === undefined ? undefined : tables.variants.get(variantName),
  );
}

function createModelAccessorInScope<
  TContract extends Contract<SqlStorage>,
  NsId extends string,
  ModelName extends string,
  VariantName extends string | undefined = undefined,
>(
  context: ExecutionContext<TContract>,
  namespaceId: NsId,
  modelName: ModelName,
  variantName: VariantName | undefined,
  scope: TableScope,
  table: AliasedTable,
  variantTable: AliasedTable | undefined,
): VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId> {
  const contract = context.contract;
  const fieldColumns = getModelAndVariantFieldColumns(
    contract,
    namespaceId,
    modelName,
    variantName,
  );
  const modelRelations = resolveModelRelations(contract, namespaceId, modelName);
  // When a variant is selected, MTI variant-owned fields resolve to a
  // `ColumnRef` qualified against the variant table the read path joins into
  // the correlated child SELECT. STI variant columns live on the base table
  // and never appear here, so base resolution is untouched. Gating strictly
  // on `variantName` means the no-variant path (`variantName === undefined`)
  // produces exactly the same accessor it did before variant support was
  // added: an empty `variantFieldColumns`, so every field falls through to the
  // base-table column resolution below.
  const variantFieldColumns: Readonly<Record<string, FieldColumn>> = variantName
    ? resolveVariantFieldColumns(contract, namespaceId, modelName, variantName)
    : {};
  // A selected variant's own relations are resolved against the variant's
  // coordinates: the variant model name (so join columns read the variant's
  // field→column map) and the variant's table (the MTI variant table the
  // read path joins in, or the base table for STI, where the variant's
  // columns physically live). They shadow a same-named base relation.
  const variantCoordinates = variantName
    ? {
        name: variantName,
        relations: resolveModelRelations(contract, namespaceId, variantName),
      }
    : undefined;
  const variantFieldTable = variantTable ?? table;

  const opsByCodecId = new Map<string, NamedOp[]>();

  function registerOp(codecId: string, op: NamedOp) {
    let existing = opsByCodecId.get(codecId);
    if (!existing) {
      existing = [];
      opsByCodecId.set(codecId, existing);
    }
    existing.push(op);
  }

  for (const [name, entry] of Object.entries(context.queryOperations.entries())) {
    const op: NamedOp = [name, entry];
    const self = entry.self;
    if (!self) continue;
    if (self.codecId !== undefined) {
      registerOp(self.codecId, op);
    } else if (self.traits !== undefined) {
      for (const descriptor of context.codecDescriptors.values()) {
        const descriptorTraits: readonly string[] = descriptor.traits;
        if (self.traits.every((t) => descriptorTraits.includes(t))) {
          registerOp(descriptor.codecId, op);
        }
      }
    }
  }

  const accessor = new Proxy(
    {},
    {
      get(target, prop: string | symbol): unknown {
        if (typeof prop !== 'string') {
          return undefined;
        }

        if (variantCoordinates && Object.hasOwn(variantCoordinates.relations, prop)) {
          const variantRelation = variantCoordinates.relations[prop];
          if (variantRelation) {
            return createRelationFilterAccessor(
              context,
              namespaceId,
              variantCoordinates.name,
              scope,
              variantFieldTable,
              variantRelation,
            );
          }
        }

        const relation = Object.hasOwn(modelRelations, prop) ? modelRelations[prop] : undefined;
        if (relation) {
          return createRelationFilterAccessor(
            context,
            namespaceId,
            modelName,
            scope,
            table,
            relation,
          );
        }

        const variantField = Object.hasOwn(variantFieldColumns, prop)
          ? variantFieldColumns[prop]
          : undefined;
        if (variantField === undefined && !Object.hasOwn(fieldColumns, prop)) {
          if (isProbedByRuntime(prop)) return probedValue(target, prop);
        }
        const fieldTable = variantField ? variantFieldTable : table;
        const fieldStorage = fieldTable.storage;
        const columnName =
          variantField?.column ??
          columnOfCallerField(
            contract,
            namespaceId,
            fieldColumns,
            addressedModelName(modelName, variantName),
            prop,
          );
        const column = resolveColumn(
          contract,
          fieldStorage.namespaceId,
          fieldStorage.tableName,
          columnName,
        );
        if (!column) {
          throw new InternalError(
            `Field "${modelName}.${prop}" maps column "${columnName}", which table "${fieldStorage.tableName}" does not have`,
          );
        }
        const traits = codecTraits(context, column.codecId);
        const operations = opsByCodecId.get(column.codecId) ?? [];
        const codec = codecRefForStorageColumn(
          contract.storage,
          fieldStorage.namespaceId,
          fieldStorage.tableName,
          columnName,
        );
        return createScalarFieldAccessor(
          fieldTable,
          columnName,
          column.codecId,
          column.nullable,
          codec,
          traits,
          operations,
          context,
        );
      },
    },
  );
  return blindCast<
    VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId>,
    'model accessor proxy resolves declared model fields and the selected variant fields dynamically'
  >(accessor);
}

function createScalarFieldAccessor(
  table: AliasedTable,
  columnName: string,
  codecId: string,
  nullable: boolean,
  codec: CodecRef | undefined,
  traits: readonly string[],
  operations: readonly NamedOp[],
  context: ExecutionContext,
): Partial<ComparisonMethodFns<unknown>> {
  const column = table.column(columnName);
  const comparisonEntries: Array<[string, unknown]> = [];
  for (const [name, meta] of Object.entries(COMPARISON_METHODS_META)) {
    if (meta.traits.some((t) => !traits.includes(t))) continue;
    comparisonEntries.push([name, meta.create(column, codec)]);
  }

  const accessor = blindCast<
    Expression<ScopeField> & Record<string, unknown>,
    'scalar field accessor combines the expression protocol with generated comparison methods'
  >({
    returnType: { codecId, nullable, codec },
    buildAst: () => column,
    ...Object.fromEntries(comparisonEntries),
  });

  for (const [name, entry] of operations) {
    accessor[name] = createExtensionMethodFactory(accessor, entry, context);
  }

  return blindCast<
    Partial<ComparisonMethodFns<unknown>>,
    'scalar field accessor exposes comparison methods dynamically by codec traits'
  >(accessor);
}

function createExtensionMethodFactory(
  selfExpr: Expression<ScopeField>,
  entry: SqlOperationEntry,
  context: ExecutionContext,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    // `entry.impl` is typed `(...args: never[]) => QueryOperationReturn` —
    // `never[]` args block direct invocation with unknown values, and the
    // declared return omits `buildAst` (sql-contract intentionally doesn't
    // depend on relational-core). Cast here to the practical shape: authors
    // always return Expression<ScopeField> via `buildOperation`.
    const impl = blindCast<
      (self: unknown, ...args: unknown[]) => Expression<ScopeField>,
      'registered SQL operation implementations return relational-core expressions at runtime'
    >(entry.impl);
    const result = impl(selfExpr, ...args);
    const returnCodecId = result.returnType.codecId;
    const returnTraits = codecTraits(context, returnCodecId);
    const isPredicate = returnTraits.includes('boolean');

    if (isPredicate) {
      return result.buildAst();
    }

    const resultAst = result.buildAst();
    const returnCodec: CodecRef = { codecId: returnCodecId };
    const methods: Record<string, unknown> = {};
    for (const [resultMethodName, meta] of Object.entries(COMPARISON_METHODS_META)) {
      if (meta.traits.some((t) => !returnTraits.includes(t))) continue;
      methods[resultMethodName] = meta.create(resultAst, returnCodec);
    }
    return methods;
  };
}

type RelationAccessor<TContract extends Contract<SqlStorage>> = RelationFilterAccessor<
  TContract,
  string,
  string
> & { readonly [member: string]: unknown };

const RELATION_ACCESSOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  'some',
  'every',
  'none',
  'count',
]);

function createRelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  ParentModelName extends string,
>(
  context: ExecutionContext<TContract>,
  parentNamespaceId: string,
  parentModelName: ParentModelName,
  scope: TableScope,
  parentTable: AliasedTable,
  relation: ResolvedModelRelation,
): RelationAccessor<TContract> {
  const relatedTableName = resolveModelTableName(
    context.contract,
    relation.toNamespace,
    relation.to,
  );
  const correlate = () =>
    correlateRelatedRows(
      context,
      parentNamespaceId,
      parentModelName,
      scope,
      parentTable,
      relatedTableName,
      relation,
    );

  const filters: RelationFilterAccessor<TContract, string, string> = {
    some: (predicate) => buildExistsExpr(context, relation, scope, correlate(), 'some', predicate),
    every: (predicate) =>
      buildExistsExpr(context, relation, scope, correlate(), 'every', predicate),
    none: (predicate) => buildExistsExpr(context, relation, scope, correlate(), 'none', predicate),
  };

  if (isToOneCardinality(relation.cardinality)) {
    return new Proxy(filters, {
      get(target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (Object.hasOwn(target, prop)) return Reflect.get(target, prop);
        if (RELATION_ACCESSOR_METHOD_NAMES.has(prop)) return undefined;
        if (
          isProbedByRuntime(prop) &&
          !Object.hasOwn(
            getModelFieldColumns(context.contract, relation.toNamespace, relation.to),
            prop,
          )
        ) {
          return probedValue(target, prop);
        }
        return relatedOrderableField(context, relation, relatedTableName, correlate, prop);
      },
    });
  }

  return {
    ...filters,
    count: (predicate: RelationPredicateInput<TContract, string, string> | undefined) =>
      createOrderable(() =>
        buildRelationCountExpr(context, relation, scope, correlate(), predicate),
      ),
  };
}

/**
 * Whether the JavaScript runtime or a common library reads `prop` from an object it is handed: `then` when a value is awaited or resolved as a promise, `toJSON` when it is stringified, and the `Object.prototype` members such as `toString`. An accessor answers these like a plain object, so a name that is not a field is refused only when the caller asks for it.
 */
function isProbedByRuntime(prop: string): boolean {
  return prop === 'then' || prop === 'toJSON' || prop in Object.prototype;
}

function probedValue(target: object, prop: string): unknown {
  return prop === 'then' || prop === 'toJSON' ? undefined : Reflect.get(target, prop);
}

function createOrderable(buildExpr: () => AnyExpression): Orderable {
  return {
    asc: (options?: OrderOptions) => checkedOrderByItem('asc', buildExpr(), options),
    desc: (options?: OrderOptions) => checkedOrderByItem('desc', buildExpr(), options),
  };
}

function relatedOrderableField<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  relation: ResolvedModelRelation,
  relatedTableName: string,
  correlate: () => CorrelatedRelatedRows,
  fieldName: string,
): Orderable | undefined {
  const columnName = columnOfCallerField(
    context.contract,
    relation.toNamespace,
    getModelFieldColumns(context.contract, relation.toNamespace, relation.to),
    relation.to,
    fieldName,
  );
  const column = resolveColumn(
    context.contract,
    relation.toNamespace,
    relatedTableName,
    columnName,
  );
  if (!column || !hasTrait(context, column.codecId, 'order')) return undefined;
  return createOrderable(() => {
    const rows = correlate();
    return SubqueryExpr.of(
      rows.source
        .withProjection([ProjectionItem.of(columnName, rows.child.column(columnName))])
        .withWhere(rows.correlation),
    );
  });
}

function buildRelationCountExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  relation: ResolvedModelRelation,
  scope: TableScope,
  rows: CorrelatedRelatedRows,
  predicate: RelationPredicateInput<TContract, string, string> | undefined,
): AnyExpression {
  const childWhere = toRelationWhereExpr(
    context,
    relation.toNamespace,
    relation.to,
    predicate,
    scope,
    rows.child,
  );
  return SubqueryExpr.of(
    rows.source
      .withProjection([ProjectionItem.of('count', plainAggregateExpr('count', undefined))])
      .withWhere(childWhere ? and(rows.correlation, childWhere) : rows.correlation),
  );
}

interface CorrelatedRelatedRows {
  readonly child: AliasedTable;
  readonly source: SelectAst;
  readonly correlation: AnyExpression;
  readonly keyColumn: string;
}

function correlateRelatedRows<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  parentNamespaceId: string,
  parentModelName: string,
  scope: TableScope,
  parentTable: AliasedTable,
  relatedTableName: string,
  relation: ResolvedModelRelation,
): CorrelatedRelatedRows {
  const child = scope.aliasTable({
    namespaceId: relation.toNamespace,
    tableName: relatedTableName,
  });

  if (hasThrough(relation)) {
    const { through } = relation;
    const junction = scope.aliasTable({
      namespaceId: through.namespaceId,
      tableName: through.table,
    });
    const junctionJoinOn = buildPairedColumnExprs(
      junction,
      through.childColumns,
      child,
      through.targetColumns,
    );
    const parentLocalColumns = relation.on.localFields.map((field) =>
      columnOfContractField(context.contract, parentNamespaceId, parentModelName, field),
    );
    return {
      child,
      source: SelectAst.from(child.tableSource(context.contract)).withJoins([
        JoinAst.inner(junction.tableSource(context.contract), junctionJoinOn),
      ]),
      correlation: buildPairedColumnExprs(
        junction,
        through.parentColumns,
        parentTable,
        parentLocalColumns,
      ),
      keyColumn: firstJoinColumn(through.targetColumns, 'targetColumns'),
    };
  }

  return {
    child,
    source: SelectAst.from(child.tableSource(context.contract)),
    correlation: buildJoinWhere(
      context.contract,
      parentNamespaceId,
      parentModelName,
      parentTable,
      child,
      relation,
    ),
    keyColumn: firstJoinColumn(
      resolveRelationTargetColumns(context.contract, relation),
      'targetFields',
    ),
  };
}

function buildExistsExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  relation: ResolvedModelRelation,
  scope: TableScope,
  rows: CorrelatedRelatedRows,
  mode: RelationFilterMode,
  predicate: RelationPredicateInput<TContract, string, string> | undefined,
): AnyExpression {
  const childWhere = toRelationWhereExpr(
    context,
    relation.toNamespace,
    relation.to,
    predicate,
    scope,
    rows.child,
  );

  const filterPlan = planRelationFilterMode(rows.correlation, childWhere, mode);
  if (filterPlan.kind === 'constantTrue') {
    return AndExpr.true();
  }

  const subquery = rows.source
    .withProjection([ProjectionItem.of('_exists', rows.child.column(rows.keyColumn))])
    .withWhere(filterPlan.where);

  return filterPlan.notExists ? ExistsExpr.notExists(subquery) : ExistsExpr.exists(subquery);
}

function planRelationFilterMode(
  joinWhere: AnyExpression,
  childWhere: AnyExpression | undefined,
  mode: RelationFilterMode,
): RelationFilterPlan {
  if (mode === 'every') {
    if (!childWhere) {
      return { kind: 'constantTrue' };
    }
    return { kind: 'exists', notExists: true, where: and(joinWhere, not(childWhere)) };
  }

  if (mode === 'none') {
    return {
      kind: 'exists',
      notExists: true,
      where: childWhere ? and(joinWhere, childWhere) : joinWhere,
    };
  }

  return {
    kind: 'exists',
    notExists: false,
    where: childWhere ? and(joinWhere, childWhere) : joinWhere,
  };
}

function firstJoinColumn(columns: readonly string[], label: string): string {
  const first = columns[0];
  if (!first) {
    throw new InternalError(`Relation metadata is missing ${label}`);
  }
  return first;
}

function buildPairedColumnExprs(
  leftTable: AliasedTable,
  leftColumns: readonly string[],
  rightTable: AliasedTable,
  rightColumns: readonly string[],
): AnyExpression {
  if (leftColumns.length !== rightColumns.length) {
    throw new InternalError(
      `Relation metadata has mismatched join column counts: ${leftColumns.length} left column(s), ${rightColumns.length} right column(s)`,
    );
  }
  if (leftColumns.length === 0) {
    throw new InternalError('Relation metadata is missing join columns');
  }
  const exprs: AnyExpression[] = [];
  for (let i = 0; i < leftColumns.length; i++) {
    const left = leftColumns[i];
    const right = rightColumns[i];
    if (!left || !right) {
      throw new InternalError(`Relation metadata is missing a join column pair at index ${i}`);
    }
    exprs.push(BinaryExpr.eq(leftTable.column(left), rightTable.column(right)));
  }
  if (exprs.length === 1 && exprs[0]) {
    return exprs[0];
  }
  return and(...exprs);
}

function toRelationWhereExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  relatedNamespaceId: string,
  relatedModelName: string,
  predicate: RelationPredicateInput<TContract, string, string> | undefined,
  scope: TableScope,
  table: AliasedTable,
): AnyExpression | undefined {
  if (!predicate) {
    return undefined;
  }

  // Both callback and shorthand paths use the trait-gated accessor.
  const accessor = createModelAccessorInScope(
    context,
    relatedNamespaceId,
    relatedModelName,
    undefined,
    scope,
    table,
    undefined,
  );

  if (typeof predicate === 'function') {
    return predicate(accessor);
  }

  // Shorthand object — skip fields without eq
  assertModelFieldNames(context.contract, relatedNamespaceId, relatedModelName, predicate);
  const exprs: AnyExpression[] = [];
  for (const [fieldName, value] of Object.entries(predicate)) {
    if (value === undefined) {
      continue;
    }

    const fieldAccessors = blindCast<
      Record<string, Partial<ComparisonMethodFns<unknown>>>,
      'relation shorthand fields are read from the dynamic model accessor proxy'
    >(accessor);
    const fieldAccessor = fieldAccessors[fieldName];
    if (!fieldAccessor) {
      throw new InternalError(
        `Shorthand filter on "${relatedModelName}.${fieldName}": the field's column is missing from its table`,
      );
    }

    if (value === null) {
      if (!fieldAccessor.isNull) {
        throw new InternalError(
          `Shorthand filter on "${relatedModelName}.${fieldName}": isNull is unexpectedly missing — this is a bug in trait gating`,
        );
      }
      exprs.push(fieldAccessor.isNull());
      continue;
    }

    if (!fieldAccessor.eq) {
      throw ormError(
        'ORM.FILTER_UNSUPPORTED',
        `Shorthand filter on "${relatedModelName}.${fieldName}": field does not support equality comparisons`,
        { meta: { model: relatedModelName, field: fieldName, trait: 'equality' } },
      );
    }
    exprs.push(fieldAccessor.eq(value));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function buildJoinWhere<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  parentNamespaceId: string,
  parentModelName: string,
  parentTable: AliasedTable,
  relatedTable: AliasedTable,
  relation: ResolvedModelRelation,
): AnyExpression {
  const localFields = relation.on?.localFields ?? [];
  const targetFields = relation.on?.targetFields ?? [];

  const joinExprs: AnyExpression[] = [];
  const count = Math.min(localFields.length, targetFields.length);

  for (let i = 0; i < count; i++) {
    const localField = localFields[i];
    const targetField = targetFields[i];
    if (!localField || !targetField) {
      continue;
    }

    const localColumn = columnOfContractField(
      contract,
      parentNamespaceId,
      parentModelName,
      localField,
    );
    const targetColumn = columnOfContractField(
      contract,
      relation.toNamespace,
      relation.to,
      targetField,
    );

    joinExprs.push(
      BinaryExpr.eq(relatedTable.column(targetColumn), parentTable.column(localColumn)),
    );
  }

  if (joinExprs.length === 0) {
    throw new InternalError('Relation metadata is missing join columns');
  }

  const firstExpr = joinExprs[0];
  if (joinExprs.length === 1 && firstExpr !== undefined) {
    return firstExpr;
  }

  return and(...joinExprs);
}
