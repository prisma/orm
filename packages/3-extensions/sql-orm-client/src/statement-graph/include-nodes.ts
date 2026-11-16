import { resolveRowIdentityColumns } from '../collection-contract';
import { readsNoRows, relatedReadsOf } from '../collection-dispatch';
import { projectTableColumn } from '../mutation-statements';
import { ormError } from '../orm-errors';
import { relatedRowsSelect } from '../query-plan-select';
import type { IncludeExpr } from '../types';
import type { ColumnMapping, NodeId } from './edge';
import { FindRelated, RELATED_KEY_LIMITS } from './find-related';
import type { Builder, Model } from './model-statements';
import { type Nest, NestJoin } from './nest-join';
import { Rows } from './rows';
import { WholeRows } from './whole-rows';

type ParentModel = Pick<Model, 'modelName' | 'tables'>;

/** Reads the rows of each include one query per relation, matched to the parent rows by the parent table's identity, which every level must have. */
export function addIncludeNodes(
  b: Builder,
  parent: NodeId,
  parentModel: ParentModel,
  includes: readonly IncludeExpr[],
): NodeId {
  const reads = includes.flatMap(relatedReadsOf).filter((read) => !readsNoRows(read));
  const [first] = reads;
  if (first === undefined) {
    return parent;
  }
  const { graph, context } = b;
  const { contract } = context;
  const parentTables = parentModel.tables;
  const { namespaceId, tableName } = parentTables.root.storage;
  const identity = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identity.length === 0) {
    throw identityMissing(parentModel.modelName, tableName, first.include.relationName);
  }
  const { root } = parentTables;
  const keyColumns = identity.map((column): ColumnMapping => {
    const item = projectTableColumn(contract, root, column);
    return [item, item];
  });
  const children = reads.map(({ key, include }) => {
    const { ast, parentKeys } = relatedRowsSelect(
      contract,
      context.aggregateDescriptors,
      parentTables,
      include,
    );
    const found = new FindRelated(ast, keyColumns, RELATED_KEY_LIMITS);
    const read = graph.add(found, {
      keys: new Rows(parent, keyColumns),
      state: graph.stateEdgesFor(found),
    });
    const nest: Nest = { name: key, parentKey: identity, childKey: parentKeys };
    const rows =
      include.scalar === undefined
        ? addIncludeNodes(
            b,
            read,
            { modelName: include.relatedModelName, tables: include.nested.tables },
            include.nested.includes,
          )
        : read;
    return { rows, nest };
  });
  return graph.add(new NestJoin(children.map(({ nest }) => nest)), {
    left: new WholeRows(parent),
    children: children.map(({ rows }) => new WholeRows(rows)),
  });
}

export function identityMissing(modelName: string, tableName: string, include: string) {
  return ormError(
    'ORM.ROW_IDENTITY_MISSING',
    `Cannot load include "${include}" of model "${modelName}": table "${tableName}" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.`,
    { meta: { model: modelName, table: tableName, include } },
  );
}
