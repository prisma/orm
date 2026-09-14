import type { Contract } from '@internal/contract/types';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import type { SqlOperationEntry } from '@internal/sql-operations';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type CodecRef,
  ColumnRef,
  ExistsExpr,
  JoinAst,
  ProjectionItem,
  SelectAst,
  type TableSource,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { Expression, ScopeField } from '@internal/sql-relational-core/expression';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import {
  getFieldToColumnMap,
  resolveFieldToColumn,
  resolveModelRelations,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolveVariantFieldColumns,
  type VariantColumnRef,
} from './collection-contract';
import { and, not } from './filters';
import { ormError } from './orm-errors';
import { storageTableForContract, tableSourceForContract } from './storage-resolution';
import {
  COMPARISON_METHODS_META,
  type ComparisonMethodFns,
  type ModelAccessor,
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

type RelationAliasKind = 'rel' | 'junction';

interface StorageTableCoordinate {
  readonly namespaceId: string;
  readonly tableName: string;
}

class SqlTableBinding {
  readonly #storage: StorageTableCoordinate;
  readonly #reference: string;

  private constructor(storage: StorageTableCoordinate, reference: string) {
    this.#storage = Object.freeze({ ...storage });
    this.#reference = reference;
    Object.freeze(this);
  }

  static unaliased(storage: StorageTableCoordinate): SqlTableBinding {
    return new SqlTableBinding(storage, storage.tableName);
  }

  static aliased(storage: StorageTableCoordinate, alias: string): SqlTableBinding {
    return new SqlTableBinding(storage, alias);
  }

  column(columnName: string): ColumnRef {
    return ColumnRef.of(this.#reference, columnName);
  }

  tableSource(contract: Contract<SqlStorage>): TableSource {
    return tableSourceForContract(
      contract,
      this.#storage.namespaceId,
      this.#storage.tableName,
      this.#reference,
    );
  }

  isReferencedAs(candidate: string): boolean {
    return this.#reference === candidate;
  }

  isStoredAt(namespaceId: string, tableName: string): boolean {
    return this.#storage.namespaceId === namespaceId && this.#storage.tableName === tableName;
  }
}

interface RelationAliasCounter {
  nextId: number;
}

class ModelAccessorScope {
  readonly #visibleBindings: readonly SqlTableBinding[];
  readonly #aliasCounter: RelationAliasCounter;

  private constructor(
    readonly current: SqlTableBinding,
    visibleBindings: readonly SqlTableBinding[],
    aliasCounter: RelationAliasCounter,
  ) {
    this.#visibleBindings = Object.freeze([...visibleBindings]);
    this.#aliasCounter = aliasCounter;
    Object.freeze(this);
  }

  static root(namespaceId: string, tableName: string): ModelAccessorScope {
    const binding = SqlTableBinding.unaliased({ namespaceId, tableName });
    return new ModelAccessorScope(binding, [binding], { nextId: 1 });
  }

  forRelation(namespaceId: string, tableName: string): ModelAccessorScope {
    const binding = this.#allocateBinding(namespaceId, tableName, 'rel');
    return new ModelAccessorScope(binding, [...this.#visibleBindings, binding], this.#aliasCounter);
  }

  forManyToManyRelation(
    childNamespaceId: string,
    childTableName: string,
    junctionNamespaceId: string,
    junctionTableName: string,
  ): { readonly childScope: ModelAccessorScope; readonly junctionBinding: SqlTableBinding } {
    const initialChildScope = this.forRelation(childNamespaceId, childTableName);
    const junctionBinding = initialChildScope.#allocateBinding(
      junctionNamespaceId,
      junctionTableName,
      'junction',
    );
    const childScope = new ModelAccessorScope(
      initialChildScope.current,
      [...initialChildScope.#visibleBindings, junctionBinding],
      this.#aliasCounter,
    );
    return { childScope, junctionBinding };
  }

  forJoinedSource(namespaceId: string, tableName: string): ModelAccessorScope {
    if (this.current.isStoredAt(namespaceId, tableName)) {
      return this;
    }
    const binding = SqlTableBinding.unaliased({ namespaceId, tableName });
    return new ModelAccessorScope(binding, [...this.#visibleBindings, binding], this.#aliasCounter);
  }

  #allocateBinding(
    namespaceId: string,
    tableName: string,
    aliasKind: RelationAliasKind,
  ): SqlTableBinding {
    const storage = { namespaceId, tableName };
    if (!this.#visibleBindings.some((binding) => binding.isReferencedAs(tableName))) {
      return SqlTableBinding.unaliased(storage);
    }
    return SqlTableBinding.aliased(storage, this.#allocateAlias(aliasKind));
  }

  #allocateAlias(kind: RelationAliasKind): string {
    while (true) {
      const alias = `__orm_${kind}_${this.#aliasCounter.nextId}`;
      this.#aliasCounter.nextId += 1;
      if (!this.#visibleBindings.some((binding) => binding.isReferencedAs(alias))) {
        return alias;
      }
    }
  }
}

export function createModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  VariantName extends string | undefined = undefined,
  NsId extends string = string,
>(
  context: ExecutionContext<TContract>,
  namespaceId: NsId,
  modelName: ModelName,
  variantName?: VariantName,
): VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId> {
  const tableName = resolveModelTableName(context.contract, namespaceId, modelName);
  return createModelAccessorInScope(
    context,
    namespaceId,
    modelName,
    variantName,
    ModelAccessorScope.root(namespaceId, tableName),
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
  scope: ModelAccessorScope,
): VariantAwareModelAccessor<TContract, ModelName, VariantName, NsId> {
  const contract = context.contract;
  const fieldToColumn = getFieldToColumnMap(contract, namespaceId, modelName);
  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const modelRelations = resolveModelRelations(contract, namespaceId, modelName);
  // When a variant is selected, MTI variant-owned fields resolve to a
  // `ColumnRef` qualified against the variant table the read path joins into
  // the correlated child SELECT. STI variant columns live on the base table
  // and never appear here, so base resolution is untouched. Gating strictly
  // on `variantName` means the no-variant path (`variantName === undefined`)
  // produces exactly the same accessor it did before variant support was
  // added: an empty `variantFieldColumns`, so every field falls through to the
  // base-table column resolution below.
  const variantFieldColumns: Record<string, VariantColumnRef> = variantName
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
        tableName:
          resolvePolymorphismInfo(contract, namespaceId, modelName)?.variants.get(variantName)
            ?.table ?? tableName,
      }
    : undefined;

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
      get(_target, prop: string | symbol): unknown {
        if (typeof prop !== 'string') {
          return undefined;
        }

        if (variantCoordinates) {
          const variantRelation = variantCoordinates.relations[prop];
          if (variantRelation) {
            return createRelationFilterAccessor(
              context,
              namespaceId,
              variantCoordinates.name,
              scope.forJoinedSource(namespaceId, variantCoordinates.tableName),
              variantRelation,
            );
          }
        }

        const relation = modelRelations[prop];
        if (relation) {
          return createRelationFilterAccessor(context, namespaceId, modelName, scope, relation);
        }

        const variantField = variantFieldColumns[prop];
        const resolvedTable = variantField?.table ?? tableName;
        const fieldBinding = scope.forJoinedSource(namespaceId, resolvedTable).current;
        const columnName = variantField?.column ?? fieldToColumn[prop] ?? prop;
        const column = resolveColumn(contract, namespaceId, resolvedTable, columnName);
        // Unknown fields return `undefined`, matching plain JS object semantics.
        // The `ModelAccessor<TContract, ModelName>` type already rejects typos
        // at compile time for TS consumers, and contexts that iterate accessor
        // keys (e.g. relation-shorthand predicates) can detect missing fields
        // with an `undefined` check and raise their own, domain-specific error.
        if (!column) {
          return undefined;
        }
        const traits = context.codecDescriptors.descriptorFor(column.codecId)?.traits ?? [];
        const operations = opsByCodecId.get(column.codecId) ?? [];
        const codec = codecRefForStorageColumn(
          contract.storage,
          namespaceId,
          resolvedTable,
          columnName,
        );
        return createScalarFieldAccessor(
          fieldBinding,
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
    VariantAwareModelAccessor<TContract, ModelName, VariantName>,
    'model accessor proxy resolves declared model fields and the selected variant fields dynamically'
  >(accessor);
}

function resolveColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  columnName: string,
): { readonly codecId: string; readonly nullable: boolean } | undefined {
  let table: StorageTable;
  try {
    table = storageTableForContract(contract, namespaceId, tableName);
  } catch {
    return undefined;
  }
  const column = table.columns[columnName];
  if (!column) return undefined;
  return { codecId: column.codecId, nullable: column.nullable };
}

function createScalarFieldAccessor(
  tableBinding: SqlTableBinding,
  columnName: string,
  codecId: string,
  nullable: boolean,
  codec: CodecRef | undefined,
  traits: readonly string[],
  operations: readonly NamedOp[],
  context: ExecutionContext,
): Partial<ComparisonMethodFns<unknown>> {
  const column = tableBinding.column(columnName);
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
    codec,
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
    const returnTraits = context.codecDescriptors.descriptorFor(returnCodecId)?.traits ?? [];
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

function createRelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  ParentModelName extends string,
>(
  context: ExecutionContext<TContract>,
  parentNamespaceId: string,
  parentModelName: ParentModelName,
  parentScope: ModelAccessorScope,
  relation: ResolvedModelRelation,
): RelationFilterAccessor<TContract, string, string> {
  const relatedTableName = resolveModelTableName(
    context.contract,
    relation.toNamespace,
    relation.to,
  );

  const relationAccessor: RelationFilterAccessor<TContract, string, string> = {
    some: (predicate) =>
      buildExistsExpr(
        context,
        parentNamespaceId,
        parentModelName,
        parentScope,
        relatedTableName,
        relation,
        { mode: 'some', predicate },
      ),
    every: (predicate) =>
      buildExistsExpr(
        context,
        parentNamespaceId,
        parentModelName,
        parentScope,
        relatedTableName,
        relation,
        { mode: 'every', predicate },
      ),
    none: (predicate) =>
      buildExistsExpr(
        context,
        parentNamespaceId,
        parentModelName,
        parentScope,
        relatedTableName,
        relation,
        { mode: 'none', predicate },
      ),
  };

  return relationAccessor;
}

function buildExistsExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  parentNamespaceId: string,
  parentModelName: string,
  parentScope: ModelAccessorScope,
  relatedTableName: string,
  relation: ResolvedModelRelation,
  options: {
    readonly mode: RelationFilterMode;
    readonly predicate: RelationPredicateInput<TContract, string, string> | undefined;
  },
): AnyExpression {
  if (hasThrough(relation)) {
    return buildManyToManyExistsExpr(
      context,
      parentNamespaceId,
      parentModelName,
      parentScope,
      relatedTableName,
      relation,
      options,
    );
  }

  const childScope = parentScope.forRelation(relation.toNamespace, relatedTableName);
  const joinWhere = buildJoinWhere(
    context.contract,
    parentNamespaceId,
    parentModelName,
    parentScope.current,
    childScope.current,
    relation,
  );
  const childWhere = toRelationWhereExpr(
    context,
    relation.toNamespace,
    relation.to,
    options.predicate,
    childScope,
  );

  const filterPlan = planRelationFilterMode(joinWhere, childWhere, options.mode);
  if (filterPlan.kind === 'constantTrue') {
    return AndExpr.true();
  }

  const selectProjectionColumn = firstTargetColumn(context.contract, relation) ?? 'id';
  const subquery = SelectAst.from(childScope.current.tableSource(context.contract))
    .withProjection([
      ProjectionItem.of('_exists', childScope.current.column(selectProjectionColumn)),
    ])
    .withWhere(filterPlan.where);

  return filterPlan.notExists ? ExistsExpr.notExists(subquery) : ExistsExpr.exists(subquery);
}

function buildManyToManyExistsExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  parentNamespaceId: string,
  parentModelName: string,
  parentScope: ModelAccessorScope,
  relatedTableName: string,
  relation: ResolvedModelRelationWithThrough,
  options: {
    readonly mode: RelationFilterMode;
    readonly predicate: RelationPredicateInput<TContract, string, string> | undefined;
  },
): AnyExpression {
  const { through } = relation;
  const { childScope, junctionBinding } = parentScope.forManyToManyRelation(
    relation.toNamespace,
    relatedTableName,
    through.namespaceId,
    through.table,
  );

  const junctionJoinOn = buildPairedColumnExprs(
    junctionBinding,
    through.childColumns,
    childScope.current,
    through.targetColumns,
  );

  const parentLocalColumns = relation.on.localFields.map((field) =>
    resolveFieldToColumn(context.contract, parentNamespaceId, parentModelName, field),
  );
  const junctionCorrelation = buildPairedColumnExprs(
    junctionBinding,
    through.parentColumns,
    parentScope.current,
    parentLocalColumns,
  );

  const childWhere = toRelationWhereExpr(
    context,
    relation.toNamespace,
    relation.to,
    options.predicate,
    childScope,
  );

  const filterPlan = planRelationFilterMode(junctionCorrelation, childWhere, options.mode);
  if (filterPlan.kind === 'constantTrue') {
    return AndExpr.true();
  }

  const firstTargetCol = firstJoinColumn(through.targetColumns, 'targetColumns');
  const subquery = SelectAst.from(childScope.current.tableSource(context.contract))
    .withJoins([JoinAst.inner(junctionBinding.tableSource(context.contract), junctionJoinOn)])
    .withProjection([ProjectionItem.of('_exists', childScope.current.column(firstTargetCol))])
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
  leftTable: SqlTableBinding,
  leftColumns: readonly string[],
  rightTable: SqlTableBinding,
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
  scope: ModelAccessorScope,
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
  );

  if (typeof predicate === 'function') {
    return predicate(accessor);
  }

  // Shorthand object — skip fields without eq
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
    // Unknown field in the shorthand predicate — the Proxy returns undefined
    // for fields the contract doesn't declare. Surface it explicitly: silent
    // skip would drop user intent (e.g. a typo'd `nmae: 'Alice'` filter would
    // match every row).
    if (!fieldAccessor) {
      throw ormError(
        'ORM.FIELD_UNKNOWN',
        `Shorthand filter on "${relatedModelName}.${fieldName}": field is not defined on the model`,
        { meta: { model: relatedModelName, field: fieldName } },
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
  parentTable: SqlTableBinding,
  relatedTable: SqlTableBinding,
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

    const localColumn = resolveFieldToColumn(
      contract,
      parentNamespaceId,
      parentModelName,
      localField,
    );
    const targetColumn = resolveFieldToColumn(
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

function firstTargetColumn<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  relation: ResolvedModelRelation,
): string | undefined {
  const targetFields = relation.on?.targetFields;
  const firstField = targetFields?.[0];
  if (!firstField) {
    return undefined;
  }
  return resolveFieldToColumn(contract, relation.toNamespace, relation.to, firstField);
}
