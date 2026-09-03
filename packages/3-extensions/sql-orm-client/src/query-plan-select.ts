import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlAggregateLowering } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AndExpr,
  type AnyExpression,
  type AnyJsonValueProjection,
  BinaryExpr,
  CodecJsonValueProjection,
  type CodecRef,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  OrderByItem,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { assertDefined, invariant } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { plainAggregateExpr, resolveAggregate } from './aggregate-codecs';
import {
  assertDistinctOnCapability,
  getCompleteColumnToFieldMap,
  getFieldToColumnMap,
  POLYMORPHIC_DISCRIMINATOR_ALIAS,
  type PolymorphismInfo,
  resolvePolymorphismInfo,
} from './collection-contract';
import { ormError } from './orm-errors';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import {
  buildDedupedTableSource,
  buildMtiJoins,
  buildStateWhere,
  createTableRefRemapper,
  wrapWithRowNumberDedup,
} from './query-plan-source';
import { augmentSelectionForJoinColumns } from './selection-shaping';
import { tableSourceForContract } from './storage-resolution';
import type { CollectionState, IncludeCombineBranch, IncludeExpr, IncludeScalar } from './types';

/**
 * The rule for which JSON projection variant an include entry carries. Every
 * site that puts a value into a `json_build_object` or a `json_agg` goes
 * through here, and the renderers read the variant to decide how the value
 * reaches JSON.
 *
 * - `codec`: the value is a column whose storage codec is known, so the
 *   renderer can ask that codec's descriptor for the projection producing its
 *   canonical JSON. The `CodecRef` is resolved at planning time by
 *   `codecRefForStorageColumn` and carried on the `ProjectionItem` through
 *   every wrap between the column and here.
 * - `document`: the value is already a JSON document — a nested include's
 *   correlated subquery, a combine branch, or the object a child row set is
 *   aggregated from. Its parts were made canonical at the level that produced
 *   them; this level only nests it.
 * - `native`: the value has no codec identity. The case that reaches it is an
 *   aggregate the target declares no overload for — SQLite computes `sum` over
 *   a text column from whatever leading numbers the rows held, and declines to
 *   type the result. Native is what a value with no codec identity means, which
 *   is a different thing from defaulting a codec to identity — that, the
 *   project forbids. An aggregate the target does declare carries the codec the
 *   registry resolved for it, like any other value.
 *
 * A document never carries a codec and a codec-bearing column is never a
 * document, so the first two cases cannot both apply.
 */
function jsonEntryProjection(
  value: ProjectionExpr,
  identity: { readonly codec?: CodecRef | undefined; readonly document?: boolean },
): AnyJsonValueProjection {
  if (identity.codec !== undefined) {
    return new CodecJsonValueProjection(value, identity.codec);
  }
  if (identity.document === true) {
    return new JsonDocumentProjection(value);
  }
  return new NativeJsonValueProjection(value);
}

function buildProjection(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  selectedFields: readonly string[] | undefined,
  tableRef = tableName,
): ProjectionItem[] {
  const columns =
    selectedFields !== undefined
      ? [...selectedFields]
      : resolveTableColumns(contract, namespaceId, tableName);

  return columns.map((column) =>
    ProjectionItem.of(
      column,
      ColumnRef.of(tableRef, column),
      codecRefForStorageColumn(contract.storage, namespaceId, tableName, column),
    ),
  );
}

interface PolymorphicProjectionSelection {
  readonly baseSelectedFields: readonly string[] | undefined;
  readonly selectedMtiColumnsByTable: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  readonly needsHiddenDiscriminator: boolean;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function resolvePolymorphicProjectionSelection(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  polyInfo: PolymorphismInfo,
  state: CollectionState,
): PolymorphicProjectionSelection {
  if (state.selectedFields === undefined) {
    return {
      baseSelectedFields: undefined,
      selectedMtiColumnsByTable: undefined,
      needsHiddenDiscriminator: false,
    };
  }

  const baseTableColumns = new Set(resolveTableColumns(contract, namespaceId, polyInfo.baseTable));
  const baseFieldToColumn = getFieldToColumnMap(contract, namespaceId, modelName);
  const variantFieldMaps = Array.from(polyInfo.variants.values(), (variant) => ({
    variant,
    columnToField: getCompleteColumnToFieldMap(contract, namespaceId, variant.modelName),
  }));
  const baseSelectedFields: string[] = [];
  const selectedMtiColumnsByTable = new Map<string, Set<string>>();
  let hasVariantOwnedSelection = false;

  for (const selectedField of state.selectedFields) {
    const baseColumn =
      baseFieldToColumn[selectedField] ??
      (baseTableColumns.has(selectedField) ? selectedField : undefined);
    if (baseColumn !== undefined) {
      appendUnique(baseSelectedFields, baseColumn);
    }

    let matchedVariantField = false;
    for (const { variant, columnToField } of variantFieldMaps) {
      for (const [column, field] of Object.entries(columnToField)) {
        if (selectedField !== field && selectedField !== column) {
          continue;
        }

        matchedVariantField = true;
        hasVariantOwnedSelection = true;
        if (variant.strategy === 'sti') {
          appendUnique(baseSelectedFields, column);
          continue;
        }

        let selectedColumns = selectedMtiColumnsByTable.get(variant.table);
        if (selectedColumns === undefined) {
          selectedColumns = new Set();
          selectedMtiColumnsByTable.set(variant.table, selectedColumns);
        }
        selectedColumns.add(column);
      }
    }

    if (baseColumn === undefined && !matchedVariantField) {
      appendUnique(baseSelectedFields, selectedField);
    }
  }

  return {
    baseSelectedFields,
    selectedMtiColumnsByTable,
    needsHiddenDiscriminator:
      state.variantName === undefined &&
      hasVariantOwnedSelection &&
      !baseSelectedFields.includes(polyInfo.discriminatorColumn),
  };
}

function buildHiddenDiscriminatorProjection(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  polyInfo: PolymorphismInfo,
  tableRef: string,
  needed: boolean,
): ReadonlyArray<ProjectionItem> {
  if (!needed) {
    return [];
  }

  return [
    ProjectionItem.of(
      POLYMORPHIC_DISCRIMINATOR_ALIAS,
      ColumnRef.of(tableRef, polyInfo.discriminatorColumn),
      codecRefForStorageColumn(
        contract.storage,
        namespaceId,
        polyInfo.baseTable,
        polyInfo.discriminatorColumn,
      ),
    ),
  ];
}

function buildIncludeOrderArtifacts(
  relationName: string,
  rowAlias: string,
  childOrderBy: readonly OrderByItem[] | undefined,
): {
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  if (!childOrderBy || childOrderBy.length === 0) {
    return {
      childOrderBy: undefined,
      hiddenOrderProjection: [],
      aggregateOrderBy: undefined,
    };
  }

  const hiddenOrderProjection = childOrderBy.map((orderItem, index) =>
    ProjectionItem.of(`${relationName}__order_${index}`, orderItem.expr),
  );
  const aggregateOrderBy = hiddenOrderProjection.map((projection, index) => {
    const orderItem = childOrderBy[index];
    if (!orderItem) {
      throw new InternalError(`Missing include order metadata at index ${index}`);
    }
    return new OrderByItem(ColumnRef.of(rowAlias, projection.alias), orderItem.dir);
  });

  return {
    childOrderBy,
    hiddenOrderProjection,
    aggregateOrderBy,
  };
}

interface IncludeParentSource {
  readonly baseTableName: string;
  readonly tableRef: string;
  readonly variantColumnsProjected: boolean;
}

function localColumnsForRowInclude(include: IncludeExpr): readonly string[] {
  return include.through?.parentLocalColumns ?? include.localColumns;
}

/**
 * Correlate a child row back to its parent across every column of the
 * relation's key. Composite foreign keys contribute one equality per
 * column, ANDed together — mirroring the relation-filter join in
 * `model-accessor.ts`. Correlating on a prefix of the key would match
 * every child sharing that prefix.
 */
function buildIncludeJoinExpr(
  include: IncludeExpr,
  childTableRef: string,
  parentLocalRefs: readonly ColumnRef[],
): AnyExpression {
  const joinExprs: AnyExpression[] = [];

  if (parentLocalRefs.length !== include.targetColumns.length) {
    throw new InternalError(`Include '${include.relationName}' has incomplete join metadata`);
  }

  for (let i = 0; i < parentLocalRefs.length; i++) {
    const parentLocalRef = parentLocalRefs[i];
    const targetColumn = include.targetColumns[i];
    if (parentLocalRef === undefined || !targetColumn) {
      throw new InternalError(`Include '${include.relationName}' has incomplete join metadata`);
    }
    joinExprs.push(BinaryExpr.eq(ColumnRef.of(childTableRef, targetColumn), parentLocalRef));
  }

  const firstExpr = joinExprs[0];
  assertDefined(firstExpr, `Include '${include.relationName}' has no parent-local column ref`);
  return joinExprs.length === 1 ? firstExpr : AndExpr.of(joinExprs);
}

function resolveParentLocalRefs(
  parentSource: IncludeParentSource,
  include: IncludeExpr,
  localColumns: readonly string[],
): readonly ColumnRef[] {
  return localColumns.map((column) => {
    if (include.localTableName === parentSource.baseTableName) {
      return ColumnRef.of(parentSource.tableRef, column);
    }
    if (parentSource.variantColumnsProjected) {
      return ColumnRef.of(parentSource.tableRef, `${include.localTableName}__${column}`);
    }
    return ColumnRef.of(include.localTableName, column);
  });
}

function resolveChildTableSource(
  include: IncludeExpr,
  parentLocalRefs: readonly ColumnRef[],
): { readonly alias: string | undefined; readonly tableRef: string } {
  const alias = parentLocalRefs.some((ref) => ref.table === include.relatedTableName)
    ? `${include.relationName}__child`
    : undefined;
  return { alias, tableRef: alias ?? include.relatedTableName };
}

/**
 * Recursively build the correlated-subquery projections for the nested
 * includes attached to a child SELECT. Used by `buildIncludeChildRowsSelect`
 * to wire depth-2+ aggregates into the inner SELECT at each level.
 *
 * Each nested include contributes a single projection item whose
 * expression is a correlated subquery.
 */
function buildNestedIncludeProjections(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  includes: readonly IncludeExpr[],
): ReadonlyArray<ProjectionItem> {
  return includes.map(
    (nested) =>
      buildCorrelatedIncludeProjection(contract, aggregates, parentSource, nested).projection,
  );
}

/**
 * The aliases a level's nested includes contribute. Each such subquery
 * projects a JSON document — an object for a scalar include, an array of
 * objects for a row include — which is what tells the enclosing level to nest
 * the value rather than convert it.
 */
function documentAliasesOf(nestedProjections: ReadonlyArray<ProjectionItem>): ReadonlySet<string> {
  return new Set(nestedProjections.map((item) => item.alias));
}

/**
 * Resolve the MTI variant joins + `variant_table__column` projection for an
 * include whose target model is polymorphic, mirroring the parent path in
 * `compileSelectWithIncludes`. The discriminator column and any STI
 * variant-specific columns live on the base table and reach the row through
 * the ordinary base-column projection (`buildProjection`); only the MTI
 * variant tables need a join.
 *
 * When the child base table is aliased (self-relations), `buildMtiJoins`
 * emits a join `ON` against the unaliased base table name, which would fall
 * out of scope. Remap it to the child alias — the same remap the row builder
 * already applies to `orderBy`/`where`.
 */
function buildChildPolymorphismJoinsAndProjection(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  childTableAlias: string | undefined,
  childTableRef: string,
): {
  readonly joins: ReadonlyArray<JoinAst>;
  readonly projection: ReadonlyArray<ProjectionItem>;
  readonly hiddenProjection: ReadonlyArray<ProjectionItem>;
  readonly baseSelectedFields: readonly string[] | undefined;
} {
  const polyInfo = resolvePolymorphismInfo(
    contract,
    include.relatedNamespaceId,
    include.relatedModelName,
  );
  if (!polyInfo) {
    return {
      joins: [],
      projection: [],
      hiddenProjection: [],
      baseSelectedFields: include.nested.selectedFields,
    };
  }

  const selection = resolvePolymorphicProjectionSelection(
    contract,
    include.relatedNamespaceId,
    include.relatedModelName,
    polyInfo,
    include.nested,
  );
  const { joins, projection } = buildMtiJoins(
    contract,
    include.relatedNamespaceId,
    polyInfo,
    include.nested.variantName,
    selection.selectedMtiColumnsByTable,
  );
  const hiddenProjection = buildHiddenDiscriminatorProjection(
    contract,
    include.relatedNamespaceId,
    polyInfo,
    childTableRef,
    selection.needsHiddenDiscriminator,
  );
  if (!childTableAlias) {
    return {
      joins,
      projection,
      hiddenProjection,
      baseSelectedFields: selection.baseSelectedFields,
    };
  }

  const remapper = createTableRefRemapper(polyInfo.baseTable, childTableRef);
  return {
    joins: joins.map((join) => join.rewrite(remapper)),
    projection,
    hiddenProjection,
    baseSelectedFields: selection.baseSelectedFields,
  };
}

function buildRequiredMtiJoinKeyProjection(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
): ReadonlyArray<ProjectionItem> {
  const polyInfo = resolvePolymorphismInfo(
    contract,
    include.relatedNamespaceId,
    include.relatedModelName,
  );
  if (!polyInfo) {
    return [];
  }

  const mtiTables = new Set(polyInfo.mtiVariants.map((variant) => variant.table));
  const aliases = new Set<string>();
  const projection: ProjectionItem[] = [];
  for (const nested of include.nested.includes) {
    if (!mtiTables.has(nested.localTableName)) {
      continue;
    }
    for (const column of localColumnsForRowInclude(nested)) {
      const alias = `${nested.localTableName}__${column}`;
      if (aliases.has(alias)) {
        continue;
      }
      aliases.add(alias);
      projection.push(
        ProjectionItem.of(
          alias,
          ColumnRef.of(nested.localTableName, column),
          codecRefForStorageColumn(
            contract.storage,
            include.relatedNamespaceId,
            nested.localTableName,
            column,
          ),
        ),
      );
    }
  }
  return projection;
}

function mergeProjectionByAlias(
  projection: readonly ProjectionItem[],
  additional: readonly ProjectionItem[],
): ProjectionItem[] {
  const aliases = new Set(projection.map((item) => item.alias));
  const merged = [...projection];
  for (const item of additional) {
    if (!aliases.has(item.alias)) {
      aliases.add(item.alias);
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Build the correlated WHERE and junction JOIN artifacts for a many-to-many
 * include. The resulting WHERE correlates the junction to the parent rows
 * (AND-ed across all column pairs for composite keys). The junction JOIN
 * connects child rows to the junction via the child columns.
 */
function buildManyToManyJunctionArtifacts(
  parentLocalRefs: readonly ColumnRef[],
  childTableRef: string,
  through: NonNullable<IncludeExpr['through']>,
): {
  readonly whereExpr: AnyExpression;
  readonly junctionJoin: JoinAst;
} {
  const { table: junctionTable, parentColumns, childColumns, targetColumns, namespaceId } = through;

  invariant(
    childColumns.length === targetColumns.length,
    `M:N junction '${junctionTable}': childColumns (${childColumns.length}) and targetColumns (${targetColumns.length}) must have equal length`,
  );
  invariant(
    parentColumns.length === parentLocalRefs.length,
    `M:N junction '${junctionTable}': parentColumns (${parentColumns.length}) and parentLocalColumns (${parentLocalRefs.length}) must have equal length`,
  );

  const joinOnPairs = childColumns.map((junctionCol, i) => {
    const targetCol = targetColumns[i];
    assertDefined(
      targetCol,
      `M:N junction '${junctionTable}': missing target column at index ${i}`,
    );
    return BinaryExpr.eq(
      ColumnRef.of(junctionTable, junctionCol),
      ColumnRef.of(childTableRef, targetCol),
    );
  });
  const firstJoinPair = joinOnPairs[0];
  const joinOn: AnyExpression =
    joinOnPairs.length === 1 && firstJoinPair ? firstJoinPair : AndExpr.of(joinOnPairs);

  const correlationPairs = parentColumns.map((junctionCol, i) => {
    const parentLocalRef = parentLocalRefs[i];
    assertDefined(
      parentLocalRef,
      `M:N junction '${junctionTable}': missing parent-local column ref at index ${i}`,
    );
    return BinaryExpr.eq(ColumnRef.of(junctionTable, junctionCol), parentLocalRef);
  });
  const firstCorrelationPair = correlationPairs[0];
  const whereExpr: AnyExpression =
    correlationPairs.length === 1 && firstCorrelationPair
      ? firstCorrelationPair
      : AndExpr.of(correlationPairs);

  const junctionJoin = JoinAst.inner(
    TableSource.named(junctionTable, undefined, namespaceId),
    joinOn,
    false,
  );

  return { whereExpr, junctionJoin };
}

function buildIncludeChildRowsSelect(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  /** Aliases in `childProjection` whose value is itself a JSON document. */
  readonly documentAliases: ReadonlySet<string>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const childState = include.nested;
  if (childState.distinctOn !== undefined && childState.distinctOn.length > 0) {
    assertDistinctOnCapability(contract, 'distinctOn');
  }
  const parentLocalRefs = resolveParentLocalRefs(
    parentSource,
    include,
    localColumnsForRowInclude(include),
  );
  const childSource = resolveChildTableSource(include, parentLocalRefs);
  const childTableAlias = childSource.alias;
  const childTableRef = childSource.tableRef;
  const rowsAlias = `${include.relationName}__rows`;
  // Self-relations rename the inner table source via `childTableAlias`,
  // so any ColumnRef the user-supplied `orderBy` carries against the
  // original `include.relatedTableName` is no longer in scope inside the
  // child SELECT. Remap before lowering to the hidden order projection
  // — mirrors the `filterTableName` remap `buildStateWhere` applies to
  // the where clauses just below.
  const remappedChildOrderBy =
    childTableAlias && childState.orderBy
      ? childState.orderBy.map((item) =>
          item.rewrite(createTableRefRemapper(include.relatedTableName, childTableRef)),
        )
      : childState.orderBy;
  const { childOrderBy, hiddenOrderProjection, aggregateOrderBy } = buildIncludeOrderArtifacts(
    include.relationName,
    rowsAlias,
    remappedChildOrderBy,
  );
  const childWhere = buildStateWhere(contract, childTableRef, childState, {
    filterTableName: include.relatedTableName,
    namespaceId: include.relatedNamespaceId,
  });

  let whereExpr: AnyExpression;
  let junctionJoins: JoinAst[] = [];

  if (include.through !== undefined) {
    const artifacts = buildManyToManyJunctionArtifacts(
      parentLocalRefs,
      childTableRef,
      include.through,
    );
    whereExpr = childWhere ? AndExpr.of([artifacts.whereExpr, childWhere]) : artifacts.whereExpr;
    junctionJoins = [artifacts.junctionJoin];
  } else {
    const joinExpr = buildIncludeJoinExpr(include, childTableRef, parentLocalRefs);
    whereExpr = childWhere ? AndExpr.of([joinExpr, childWhere]) : joinExpr;
  }

  // `distinct()` on a non-leaf include cannot be lowered as
  // `SELECT DISTINCT <scalars>, json_agg(<grandchild>) FROM ...`:
  // Postgres rejects equality on the `json` aggregate column. Instead,
  // pre-dedupe scalar child rows in a wrapped subquery — force-including
  // the grandchild join keys so the outer aggregates can correlate back
  // to the deduped rows — and attach grandchild aggregates onto that
  // wrapped result. `DISTINCT` runs over scalar columns only, no `json`
  // column is in scope, and the user-visible row shape stays bit-for-bit
  // equivalent to the multi-query stitcher's output (which applies the
  // same force-include + strip-hidden pattern in JS).
  const isDistinctNonLeaf =
    childState.distinct !== undefined &&
    childState.distinct.length > 0 &&
    childState.includes.length > 0;

  if (isDistinctNonLeaf) {
    return buildDistinctNonLeafChildRowsSelect({
      contract,
      aggregates,
      include,
      childTableAlias,
      childTableRef,
      rowsAlias,
      childOrderBy,
      hiddenOrderProjection,
      aggregateOrderBy,
      whereExpr,
      junctionJoins,
    });
  }

  const polyJoinsAndProjection = buildChildPolymorphismJoinsAndProjection(
    contract,
    include,
    childTableAlias,
    childTableRef,
  );
  const scalarProjection = buildProjection(
    contract,
    include.relatedNamespaceId,
    include.relatedTableName,
    polyJoinsAndProjection.baseSelectedFields,
    childTableRef,
  );

  // Recurse: each nested include produces a correlated subquery
  // projection. The nested aggregates are attached to *this* child
  // SELECT, so they correlate against `childTableRef` — which may itself
  // be an alias if the relation is self-referential.
  const nestedProjections = buildNestedIncludeProjections(
    contract,
    aggregates,
    {
      baseTableName: include.relatedTableName,
      tableRef: childTableRef,
      variantColumnsProjected: false,
    },
    childState.includes,
  );

  // Internal discriminator data participates in variant mapping but has no
  // model-field mapping, so it disappears before the row reaches the caller.
  // Hidden order-by projections stay separate because they must not enter the
  // JSON object at all.
  const childProjection: ReadonlyArray<ProjectionItem> = [
    ...scalarProjection,
    ...polyJoinsAndProjection.projection,
    ...polyJoinsAndProjection.hiddenProjection,
    ...nestedProjections,
  ];

  let childRows = SelectAst.from(
    tableSourceForContract(
      contract,
      include.relatedNamespaceId,
      include.relatedTableName,
      childTableAlias,
    ),
  )
    .withProjection([...childProjection, ...hiddenOrderProjection])
    .withWhere(whereExpr);
  if (polyJoinsAndProjection.joins.length > 0) {
    childRows = childRows.withJoins([...polyJoinsAndProjection.joins]);
  }

  if (junctionJoins.length > 0) {
    childRows = childRows.withJoins(junctionJoins);
  }

  if (childState.distinctOn && childState.distinctOn.length > 0) {
    childRows = childRows.withDistinctOn(
      childState.distinctOn.map((column) => ColumnRef.of(childTableRef, column)),
    );
    if (childOrderBy) {
      childRows = childRows.withOrderBy(childOrderBy);
    }
  } else if (childState.distinct && childState.distinct.length > 0) {
    // Prisma-style `.distinct(cols)`: keep one representative row per
    // (distinct cols) group. Plain SQL `DISTINCT` over the projected row
    // set dedupes nothing when the projection includes columns outside
    // `distinct cols` (typically an `id`), so we lower to a
    // `ROW_NUMBER() OVER (PARTITION BY <cols> ORDER BY …) = 1` wrap.
    // The user's `orderBy` (if any) feeds the OVER clause so it picks
    // the right representative; we reapply it on the wrapped SELECT
    // for any subsequent LIMIT/OFFSET. See `wrapWithRowNumberDedup`.
    const rankedAlias = `${include.relationName}__distinct`;
    childRows = wrapWithRowNumberDedup({
      base: childRows,
      distinctColumnRefs: childState.distinct.map((column) => ColumnRef.of(childTableRef, column)),
      rankingOrderBy: childOrderBy ?? [],
      rankedAlias,
    });
    if (childOrderBy) {
      childRows = childRows.withOrderBy(
        childOrderBy.map(
          (item, index) =>
            new OrderByItem(
              ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
              item.dir,
            ),
        ),
      );
    }
  } else if (childOrderBy) {
    childRows = childRows.withOrderBy(childOrderBy);
  }
  if (childState.limit !== undefined) {
    childRows = childRows.withLimit(childState.limit);
  }
  if (childState.offset !== undefined) {
    childRows = childRows.withOffset(childState.offset);
  }

  return {
    childRows,
    childProjection,
    documentAliases: documentAliasesOf(nestedProjections),
    rowsAlias,
    aggregateOrderBy,
  };
}

function buildDistinctNonLeafChildRowsSelect(options: {
  readonly contract: Contract<SqlStorage>;
  readonly aggregates: SqlAggregateDescriptorRegistry;
  readonly include: IncludeExpr;
  readonly childTableAlias: string | undefined;
  readonly childTableRef: string;
  readonly rowsAlias: string;
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly whereExpr: AnyExpression;
  readonly junctionJoins: ReadonlyArray<JoinAst>;
}): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  readonly documentAliases: ReadonlySet<string>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const {
    contract,
    aggregates,
    include,
    childTableAlias,
    childTableRef,
    rowsAlias,
    childOrderBy,
    hiddenOrderProjection,
    aggregateOrderBy,
    whereExpr,
    junctionJoins,
  } = options;
  const childState = include.nested;

  // Force-include every base/STI grandchild local column into the distinct
  // projection so the outer aggregates can join against the deduped rows.
  // MTI local columns are carried separately under internal table-qualified
  // aliases so they remain available for correlation without becoming visible.
  const grandchildJoinColumns = Array.from(
    new Set(
      childState.includes.flatMap((nested) =>
        nested.localTableName === include.relatedTableName ? localColumnsForRowInclude(nested) : [],
      ),
    ),
  );
  const { selectedForQuery } = augmentSelectionForJoinColumns(
    childState.selectedFields,
    grandchildJoinColumns,
  );

  // INNER: per-column-distinct scalar select with force-included join
  // keys + hidden order-by projections. No nested aggregates yet — the
  // ROW_NUMBER-based dedup only sees scalar columns; pre-deduped rows
  // are the input to the outer wrap.
  //
  // We use `ROW_NUMBER() OVER (PARTITION BY <distinct cols> ORDER BY …)
  // = 1` rather than SQL `DISTINCT` because the latter dedupes by the
  // full projected row — and we force-include grandchild join keys
  // (e.g. `post.id` so the `comments` correlated subquery can correlate). With those
  // join keys in the projection, plain `DISTINCT` would never collapse
  // rows whose ids differ, making `.distinct('title')` a no-op. The
  // window-function form partitions strictly on the user's chosen
  // columns and is therefore correct regardless of what else lives in
  // the projection.
  const visiblePolyProjection = buildChildPolymorphismJoinsAndProjection(
    contract,
    include,
    childTableAlias,
    childTableRef,
  );
  const queryInclude: IncludeExpr = {
    ...include,
    nested: { ...childState, selectedFields: selectedForQuery },
  };
  const queryPolyProjection = buildChildPolymorphismJoinsAndProjection(
    contract,
    queryInclude,
    childTableAlias,
    childTableRef,
  );
  const innerScalarProjection = buildProjection(
    contract,
    include.relatedNamespaceId,
    include.relatedTableName,
    queryPolyProjection.baseSelectedFields,
    childTableRef,
  );
  const innerMtiProjection = mergeProjectionByAlias(
    queryPolyProjection.projection,
    buildRequiredMtiJoinKeyProjection(contract, include),
  );
  let baseInner = SelectAst.from(
    tableSourceForContract(
      contract,
      include.relatedNamespaceId,
      include.relatedTableName,
      childTableAlias,
    ),
  )
    .withProjection([
      ...innerScalarProjection,
      ...innerMtiProjection,
      ...queryPolyProjection.hiddenProjection,
      ...hiddenOrderProjection,
    ])
    .withWhere(whereExpr);
  const distinctExtraJoins = [...queryPolyProjection.joins, ...junctionJoins];
  if (distinctExtraJoins.length > 0) {
    baseInner = baseInner.withJoins(distinctExtraJoins);
  }

  // `childState.distinct` is non-empty by the `isDistinctNonLeaf` guard
  // at the only caller (`buildIncludeChildRowsSelect`); assert here so
  // the partition expression list below is well-typed without a cast.
  const distinctColumns = childState.distinct;
  if (distinctColumns === undefined || distinctColumns.length === 0) {
    throw new InternalError(
      'buildDistinctNonLeafChildRowsSelect requires a non-empty `distinct` selection',
    );
  }
  const rankedAlias = `${include.relationName}__ranked`;
  let innerSelect = wrapWithRowNumberDedup({
    base: baseInner,
    distinctColumnRefs: distinctColumns.map((column) => ColumnRef.of(childTableRef, column)),
    rankingOrderBy: childOrderBy ?? [],
    rankedAlias,
  });
  if (childOrderBy) {
    // Reapply user's orderBy on the deduped result so LIMIT/OFFSET are
    // deterministic. Reference the hidden-order alias columns the
    // wrapper forwarded under their original names from `rankedAlias`.
    innerSelect = innerSelect.withOrderBy(
      childOrderBy.map(
        (item, index) =>
          new OrderByItem(
            ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
            item.dir,
          ),
      ),
    );
  }
  if (childState.limit !== undefined) {
    innerSelect = innerSelect.withLimit(childState.limit);
  }
  if (childState.offset !== undefined) {
    innerSelect = innerSelect.withOffset(childState.offset);
  }

  const distinctAlias = `${include.relationName}__distinct`;

  // OUTER: user-visible scalar projection (using the original
  // `selectedFields`, which strips any force-included hidden columns) +
  // nested aggregates correlated against the distinct alias instead of
  // the underlying table.
  const outerScalarProjection = buildProjection(
    contract,
    include.relatedNamespaceId,
    include.relatedTableName,
    visiblePolyProjection.baseSelectedFields,
    distinctAlias,
  );
  const outerNestedProjections = buildNestedIncludeProjections(
    contract,
    aggregates,
    {
      baseTableName: include.relatedTableName,
      tableRef: distinctAlias,
      variantColumnsProjected: true,
    },
    childState.includes,
  );

  // Forward the MTI variant columns the inner wrap carried under their
  // `variant_table__column` aliases onto the outer SELECT, now sourced
  // from the deduped distinct alias (their join is gone at this level).
  const outerPolyProjection = visiblePolyProjection.projection.map((proj) =>
    ProjectionItem.of(proj.alias, ColumnRef.of(distinctAlias, proj.alias), proj.codec),
  );
  const outerHiddenProjection = visiblePolyProjection.hiddenProjection.map((proj) =>
    ProjectionItem.of(proj.alias, ColumnRef.of(distinctAlias, proj.alias), proj.codec),
  );

  // Forward hidden order columns from the inner distinct subquery to the
  // outer SELECT so `aggregateOrderBy` (which still references `rowsAlias`)
  // can resolve them when the outer wrap materialises `(childRows) AS rowsAlias`.
  const outerHiddenOrderProjection = hiddenOrderProjection.map((proj) =>
    ProjectionItem.of(proj.alias, ColumnRef.of(distinctAlias, proj.alias), proj.codec),
  );

  const childProjection: ReadonlyArray<ProjectionItem> = [
    ...outerScalarProjection,
    ...outerPolyProjection,
    ...outerHiddenProjection,
    ...outerNestedProjections,
  ];

  const childRows = SelectAst.from(
    DerivedTableSource.as(distinctAlias, innerSelect),
  ).withProjection([...childProjection, ...outerHiddenOrderProjection]);

  return {
    childRows,
    childProjection,
    documentAliases: documentAliasesOf(outerNestedProjections),
    rowsAlias,
    aggregateOrderBy,
  };
}

/**
 * Build the inner SELECT for a scalar include reducer (`count` /
 * `sum` / `avg` / `min` / `max`).
 *
 * Emits one row containing `json_build_object('value', AGG(...))`
 * over the child relation correlated to the parent via the FK. The
 * JSON wrap lets the value flow through the existing include-payload
 * decoder unchanged (it JSON.parses the column and the scalar branch
 * pulls `.value` out).
 *
 * The refine state's pipeline composes through to the aggregate's
 * input set: `where` / `orderBy` / `limit` / `offset` / `distinct` shape
 * the rows the aggregate sees, matching the natural compositional
 * semantic of
 *
 *   `db.User.include('posts', p => p.where(W).limit(N).count())  // ≤ N`
 *
 * When `limit` / `offset` / `distinct` is set, the aggregate's input
 * cannot just be the bare correlated table — a top-level `LIMIT` on
 * the aggregating SELECT only trims the (already one-row) output, not
 * the rows being aggregated. We therefore wrap the source in a
 * derived SELECT that materialises the shaped row set, then
 * aggregate over that. `orderBy` alone (no `limit` / `offset` /
 * `distinct`) is dropped at the SQL level since reordering does not
 * change which rows are aggregated.
 */
function buildIncludeChildScalarSelect(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
  scalar: IncludeScalar<unknown>,
): SelectAst {
  // The reducer's result is a value in its own right, so it enters the JSON
  // envelope under the codec the target declares for it — without which a count
  // past 2^53 would arrive as a rounded JSON number — and through whatever
  // expression that target wants built for it.
  const {
    codec: resultCodec,
    input: inputCodec,
    lower: resultLowering,
  } = resolveAggregate({
    aggregates,
    contract,
    namespaceId: include.relatedNamespaceId,
    tableName: include.relatedTableName,
    fn: scalar.fn,
    column: scalar.column,
  });
  const parentLocalRefs = resolveParentLocalRefs(
    parentSource,
    include,
    localColumnsForRowInclude(include),
  );
  const childSource = resolveChildTableSource(include, parentLocalRefs);
  const childTableAlias = childSource.alias;
  const childTableRef = childSource.tableRef;
  const state = scalar.state;
  if (state.distinctOn !== undefined && state.distinctOn.length > 0) {
    assertDistinctOnCapability(contract, 'distinctOn');
  }
  const childWhere = buildStateWhere(contract, childTableRef, state, {
    filterTableName: include.relatedTableName,
    namespaceId: include.relatedNamespaceId,
  });

  let whereExpr: AnyExpression;
  let junctionJoins: JoinAst[] = [];

  if (include.through !== undefined) {
    const artifacts = buildManyToManyJunctionArtifacts(
      parentLocalRefs,
      childTableRef,
      include.through,
    );
    whereExpr = childWhere ? AndExpr.of([artifacts.whereExpr, childWhere]) : artifacts.whereExpr;
    junctionJoins = [artifacts.junctionJoin];
  } else {
    const joinExpr = buildIncludeJoinExpr(include, childTableRef, parentLocalRefs);
    whereExpr = childWhere ? AndExpr.of([joinExpr, childWhere]) : joinExpr;
  }

  // Self-relations rename the inner table source via `childTableAlias`;
  // remap any ColumnRef the user-supplied `orderBy` carries against
  // the original table name to the alias — mirrors the row-include
  // path.
  const remappedOrderBy =
    childTableAlias && state.orderBy
      ? state.orderBy.map((item) =>
          item.rewrite(createTableRefRemapper(include.relatedTableName, childTableRef)),
        )
      : state.orderBy;

  const hasPagination = state.limit !== undefined || state.offset !== undefined;
  const hasDistinct =
    (state.distinct !== undefined && state.distinct.length > 0) ||
    (state.distinctOn !== undefined && state.distinctOn.length > 0);
  const needsInnerScoping = hasPagination || hasDistinct;

  if (!needsInnerScoping) {
    const aggregateExpr = buildIncludeAggregateExpr(
      scalar,
      childTableRef,
      resultLowering,
      inputCodec,
    );
    const jsonObjectExpr = JsonObjectExpr.fromEntries([
      JsonObjectExpr.entry('value', jsonEntryProjection(aggregateExpr, { codec: resultCodec })),
    ]);
    let select = SelectAst.from(
      tableSourceForContract(
        contract,
        include.relatedNamespaceId,
        include.relatedTableName,
        childTableAlias,
      ),
    )
      .withProjection([ProjectionItem.of(include.relationName, jsonObjectExpr)])
      .withWhere(whereExpr);
    if (junctionJoins.length > 0) {
      select = select.withJoins(junctionJoins);
    }
    return select;
  }

  // Inner SELECT: materialise the shaped row set. Project only what
  // the outer aggregate needs (the aggregate's column, or a constant
  // for COUNT). ORDER BY columns are accessible via the FROM scope
  // and don't need to be in the projection. Distinct columns are
  // accessible to ROW_NUMBER OVER PARTITION BY the same way.
  //
  // Exception: when `state.distinct` (Prisma-style ROW_NUMBER dedup)
  // is combined with `orderBy`, we must reapply the ordering on the
  // wrapped (post-dedup) result so subsequent LIMIT / OFFSET slices
  // the ordered deduped rows. Postgres has no contract that rows
  // exit the `WHERE rn=1` wrap in any particular order. To do that
  // we carry hidden order columns through the wrap and re-reference
  // them on the wrapped alias — mirrors the row-include lowering in
  // `buildIncludeChildRowsSelect`'s distinct branch.
  const innerAlias = `${include.relationName}__scalar`;
  const needsHiddenOrderProjection =
    state.distinct !== undefined &&
    state.distinct.length > 0 &&
    remappedOrderBy !== undefined &&
    remappedOrderBy.length > 0;
  const hiddenOrderProjection: ReadonlyArray<ProjectionItem> = needsHiddenOrderProjection
    ? remappedOrderBy.map((item, index) =>
        ProjectionItem.of(`${include.relationName}__order_${index}`, item.expr),
      )
    : [];
  const innerProjection: ProjectionItem[] = [
    ...(scalar.column !== undefined
      ? [ProjectionItem.of(scalar.column, ColumnRef.of(childTableRef, scalar.column))]
      : [ProjectionItem.of('__row', LiteralExpr.of(1))]),
    ...hiddenOrderProjection,
  ];

  let inner = SelectAst.from(
    tableSourceForContract(
      contract,
      include.relatedNamespaceId,
      include.relatedTableName,
      childTableAlias,
    ),
  )
    .withProjection(innerProjection)
    .withWhere(whereExpr);
  if (junctionJoins.length > 0) {
    inner = inner.withJoins(junctionJoins);
  }

  if (state.distinctOn !== undefined && state.distinctOn.length > 0) {
    inner = inner.withDistinctOn(
      state.distinctOn.map((column) => ColumnRef.of(childTableRef, column)),
    );
    if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
      inner = inner.withOrderBy(remappedOrderBy);
    }
  } else if (state.distinct !== undefined && state.distinct.length > 0) {
    // Prisma-style `.distinct(cols)`: ROW_NUMBER dedup, mirroring
    // `buildIncludeChildRowsSelect`'s distinct lowering. The ranking
    // orderBy feeds the OVER clause so dedup picks the right
    // representative; the reapplied orderBy below sequences the
    // surviving rows for LIMIT / OFFSET.
    const rankedAlias = `${include.relationName}__scalar_distinct`;
    inner = wrapWithRowNumberDedup({
      base: inner,
      distinctColumnRefs: state.distinct.map((column) => ColumnRef.of(childTableRef, column)),
      rankingOrderBy: remappedOrderBy ?? [],
      rankedAlias,
    });
    if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
      inner = inner.withOrderBy(
        remappedOrderBy.map(
          (item, index) =>
            new OrderByItem(
              ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
              item.dir,
            ),
        ),
      );
    }
  } else if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
    inner = inner.withOrderBy(remappedOrderBy);
  }

  if (state.limit !== undefined) {
    inner = inner.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    inner = inner.withOffset(state.offset);
  }

  // Outer aggregating SELECT over the shaped inner row set.
  const outerAggregateExpr = buildIncludeAggregateExpr(
    scalar,
    innerAlias,
    resultLowering,
    inputCodec,
  );
  const outerJsonObjectExpr = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry('value', jsonEntryProjection(outerAggregateExpr, { codec: resultCodec })),
  ]);

  return SelectAst.from(DerivedTableSource.as(innerAlias, inner)).withProjection([
    ProjectionItem.of(include.relationName, outerJsonObjectExpr),
  ]);
}

function buildIncludeAggregateExpr(
  scalar: IncludeScalar<unknown>,
  childTableRef: string,
  lower: SqlAggregateLowering | undefined,
  inputCodec: CodecRef | undefined,
): AnyExpression {
  // A call without a column has no value to carry a codec, so the lowering is
  // told as much rather than told nothing. Whether the operation answers such
  // a call at all was the descriptor's to declare — resolution already failed
  // any pair the target does not answer.
  const expr = scalar.column === undefined ? undefined : ColumnRef.of(childTableRef, scalar.column);
  if (lower !== undefined) return lower({ expr, inputCodec });
  return plainAggregateExpr(scalar.fn, expr);
}

/**
 * Build the inner SELECT for a `combine({ a, b, ... })` include.
 *
 * Each branch produces a self-contained SELECT projecting one row
 * with one column aliased to the relation name. The branches are
 * stitched together as cross-joined derived tables (FROM <first>
 * INNER JOIN <second> ON TRUE ...), and the outer projection packs
 * them into a single `json_build_object` keyed by branch name. The
 * resulting subquery emits exactly one row per parent row containing
 * the combined JSON — embedded as a correlated subquery in the outer
 * projection.
 *
 * Row branches reuse the standalone row-include builder; scalar
 * branches reuse `buildIncludeChildScalarSelect` — the `{value: ...}`
 * envelope survives into the combined JSON and the decoder unwraps
 * it per scalar branch. Distinct/limit/offset semantics inside a row
 * branch fan out naturally because the row builder is invoked with
 * a synthetic IncludeExpr whose `nested` is the branch's state.
 */
function buildIncludeChildCombineSelect(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
  branches: Readonly<Record<string, IncludeCombineBranch>>,
): SelectAst {
  const branchEntries = Object.entries(branches);
  if (branchEntries.length === 0) {
    throw ormError(
      'ORM.INCLUDE_INVALID',
      `combine() include "${include.relationName}" has no branches`,
      {
        meta: { relation: include.relationName },
      },
    );
  }

  const compiledBranches = branchEntries.map(([name, branch]) => ({
    name,
    alias: `${include.relationName}__combine__${name}`,
    select: buildIncludeChildCombineBranchSelect(
      contract,
      aggregates,
      parentSource,
      include,
      branch,
    ),
  }));

  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    compiledBranches.map((branch) =>
      JsonObjectExpr.entry(
        branch.name,
        jsonEntryProjection(ColumnRef.of(branch.alias, include.relationName), { document: true }),
      ),
    ),
  );

  const [firstBranch, ...restBranches] = compiledBranches;
  if (!firstBranch) {
    // Unreachable given the empty-branches guard above; keeps the
    // type-narrowing honest for the destructuring read below.
    throw new InternalError(`combine() include "${include.relationName}" has no branches`);
  }

  const joins = restBranches.map((branch) =>
    JoinAst.inner(DerivedTableSource.as(branch.alias, branch.select), AndExpr.true(), false),
  );

  return SelectAst.from(DerivedTableSource.as(firstBranch.alias, firstBranch.select))
    .withProjection([ProjectionItem.of(include.relationName, jsonObjectExpr)])
    .withJoins(joins);
}

/**
 * Compile one branch of a `combine({ ... })` into a SelectAst that
 * projects exactly one row with one column aliased to the parent
 * relation name. Dispatches to the standalone scalar / row builders
 * with the branch's state spliced into a synthetic IncludeExpr.
 */
function buildIncludeChildCombineBranchSelect(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
  branch: IncludeCombineBranch,
): SelectAst {
  if (branch.kind === 'scalar') {
    return buildIncludeChildScalarSelect(
      contract,
      aggregates,
      parentSource,
      include,
      branch.selector,
    );
  }
  // Row branch: synthesize an IncludeExpr whose `nested` is the
  // branch's state, then build the standard row-aggregate inner shape.
  const syntheticInclude: IncludeExpr = {
    ...include,
    nested: branch.state,
    scalar: undefined,
    combine: undefined,
  };
  return buildIncludeChildRowsAggregateSelect(contract, aggregates, parentSource, syntheticInclude);
}

/**
 * Internal helper: build the inner aggregate SELECT that `json_agg`s
 * child rows into a single JSON-array column aliased to the relation
 * name. Used by both the standalone row correlated-subquery path and
 * by combine's row branches.
 */
function buildIncludeChildRowsAggregateSelect(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
): SelectAst {
  const { childRows, childProjection, documentAliases, rowsAlias, aggregateOrderBy } =
    buildIncludeChildRowsSelect(contract, aggregates, parentSource, include);
  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    childProjection.map((item) =>
      JsonObjectExpr.entry(
        item.alias,
        jsonEntryProjection(ColumnRef.of(rowsAlias, item.alias), {
          codec: item.codec,
          document: documentAliases.has(item.alias),
        }),
      ),
    ),
  );
  return SelectAst.from(DerivedTableSource.as(rowsAlias, childRows)).withProjection([
    ProjectionItem.of(
      include.relationName,
      JsonArrayAggExpr.of(
        jsonEntryProjection(jsonObjectExpr, { document: true }),
        'emptyArray',
        aggregateOrderBy,
      ),
    ),
  ]);
}

function buildCorrelatedIncludeProjection(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  parentSource: IncludeParentSource,
  include: IncludeExpr,
): {
  readonly projection: ProjectionItem;
} {
  if (include.scalar) {
    const scalarSelect = buildIncludeChildScalarSelect(
      contract,
      aggregates,
      parentSource,
      include,
      include.scalar,
    );
    return {
      projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(scalarSelect)),
    };
  }

  if (include.combine) {
    const combineSelect = buildIncludeChildCombineSelect(
      contract,
      aggregates,
      parentSource,
      include,
      include.combine,
    );
    return {
      projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(combineSelect)),
    };
  }

  const aggregateQuery = buildIncludeChildRowsAggregateSelect(
    contract,
    aggregates,
    parentSource,
    include,
  );
  return {
    projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(aggregateQuery)),
  };
}

function buildSelectAst(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  options: {
    readonly joins?: ReadonlyArray<JoinAst>;
    readonly includeProjection?: ReadonlyArray<ProjectionItem>;
    readonly where?: AnyExpression;
    readonly namespaceId: string;
  },
): SelectAst {
  const namespaceId = options.namespaceId;
  if (state.distinctOn !== undefined && state.distinctOn.length > 0) {
    assertDistinctOnCapability(contract, 'distinctOn');
  }
  const scalarProjection = buildProjection(
    contract,
    namespaceId,
    tableName,
    state.selectedFields,
    tableName,
  );
  const projection = [...scalarProjection, ...(options.includeProjection ?? [])];
  const where = options.where ?? buildStateWhere(contract, tableName, state, { namespaceId });

  // `buildDedupedTableSource` wraps for `.distinct(cols)`, aliased back to `tableName`.
  const allColsProjection = resolveTableColumns(contract, namespaceId, tableName).map((column) =>
    ProjectionItem.of(column, ColumnRef.of(tableName, column)),
  );
  const { source: fromSource, where: effectiveWhere } = buildDedupedTableSource(
    contract,
    namespaceId,
    tableName,
    state,
    where,
    allColsProjection,
  );

  let ast = SelectAst.from(fromSource).withProjection(projection);
  if (effectiveWhere) {
    ast = ast.withWhere(effectiveWhere);
  }
  if (state.orderBy) {
    ast = ast.withOrderBy(state.orderBy);
  }
  if (state.selectedFields === undefined) {
    ast = ast.withSelectAllIntent({ table: tableName });
  }
  if (state.distinctOn && state.distinctOn.length > 0) {
    ast = ast.withDistinctOn(state.distinctOn.map((column) => ColumnRef.of(tableName, column)));
  }
  // `state.distinct` is handled via the `usesRowNumberDistinct` wrap
  // above; we do not apply SQL `DISTINCT` here.
  if (state.limit !== undefined) {
    ast = ast.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    ast = ast.withOffset(state.offset);
  }
  if (options.joins && options.joins.length > 0) {
    ast = ast.withJoins(options.joins);
  }

  return ast;
}

export function compileSelect(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  state: CollectionState,
  modelName?: string,
): SqlQueryPlan<Record<string, unknown>> {
  if (state.distinctOn !== undefined && state.distinctOn.length > 0) {
    assertDistinctOnCapability(contract, 'distinctOn');
  }

  const polyInfo = modelName
    ? resolvePolymorphismInfo(contract, namespaceId, modelName)
    : undefined;
  const selection =
    polyInfo && modelName
      ? resolvePolymorphicProjectionSelection(contract, namespaceId, modelName, polyInfo, state)
      : undefined;
  const projectionState = selection
    ? { ...state, selectedFields: selection.baseSelectedFields }
    : state;
  const mtiArtifacts =
    polyInfo && polyInfo.mtiVariants.length > 0
      ? buildMtiJoins(
          contract,
          namespaceId,
          polyInfo,
          state.variantName,
          selection?.selectedMtiColumnsByTable,
        )
      : undefined;
  const hiddenProjection =
    polyInfo && selection
      ? buildHiddenDiscriminatorProjection(
          contract,
          namespaceId,
          polyInfo,
          tableName,
          selection.needsHiddenDiscriminator,
        )
      : [];

  const ast = buildSelectAst(
    contract,
    tableName,
    { ...projectionState, includes: [] },
    {
      joins: mtiArtifacts?.joins ?? [],
      includeProjection: [...(mtiArtifacts?.projection ?? []), ...hiddenProjection],
      namespaceId,
    },
  );

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, state.annotations);
}

export function compileSelectWithIncludes(
  contract: Contract<SqlStorage>,
  aggregates: SqlAggregateDescriptorRegistry,
  namespaceId: string,
  tableName: string,
  state: CollectionState,
  modelName?: string,
): SqlQueryPlan<Record<string, unknown>> {
  const includeJoins: JoinAst[] = [];
  const includeProjection: ProjectionItem[] = [];
  const topLevelWhere = buildStateWhere(contract, tableName, state, { namespaceId });

  const polyInfo = modelName
    ? resolvePolymorphismInfo(contract, namespaceId, modelName)
    : undefined;
  const selection =
    polyInfo && modelName
      ? resolvePolymorphicProjectionSelection(contract, namespaceId, modelName, polyInfo, state)
      : undefined;
  const projectionState = selection
    ? { ...state, selectedFields: selection.baseSelectedFields }
    : state;
  if (polyInfo && selection) {
    if (polyInfo.mtiVariants.length > 0) {
      const mtiArtifacts = buildMtiJoins(
        contract,
        namespaceId,
        polyInfo,
        state.variantName,
        selection.selectedMtiColumnsByTable,
      );
      includeJoins.push(...mtiArtifacts.joins);
      includeProjection.push(...mtiArtifacts.projection);
    }
    includeProjection.push(
      ...buildHiddenDiscriminatorProjection(
        contract,
        namespaceId,
        polyInfo,
        tableName,
        selection.needsHiddenDiscriminator,
      ),
    );
  }

  const parentSource: IncludeParentSource = {
    baseTableName: tableName,
    tableRef: tableName,
    variantColumnsProjected: false,
  };
  for (const include of state.includes) {
    const artifact = buildCorrelatedIncludeProjection(contract, aggregates, parentSource, include);
    includeProjection.push(artifact.projection);
  }

  const ast = buildSelectAst(
    contract,
    tableName,
    {
      ...projectionState,
      includes: [],
    },
    {
      joins: includeJoins,
      includeProjection,
      namespaceId,
      ...ifDefined('where', topLevelWhere),
    },
  );

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, state.annotations);
}
