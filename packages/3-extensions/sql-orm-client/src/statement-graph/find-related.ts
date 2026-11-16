import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  type AnyExpression,
  ColumnRef,
  DerivedTableSource,
  ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { combineWhereExprs } from '../where-utils';
import type { ColumnMapping, StorageRow } from './edge';
import { keyCondition } from './filter-data';
import { anyOf, withColumns } from './filtered-statement';
import { type ChunkLimits, chunkKeys } from './key-chunks';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { type Requires, requirementUnmet } from './requires';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';
import { stitchKey } from './stitch-key';

type Keyed = { keys: Rows; state: StateEdge[]; requires: Requires[] };

const KEY_LIMITS: ChunkLimits = { parameters: 10_000, bytes: 1024 * 1024 };

export class FindRelated extends StatementNode<Keyed> {
  readonly slots = { keys: 'one', state: 'list', requires: 'list' } as const;
  readonly ast: SelectAst;
  readonly keyColumns: readonly ColumnMapping[];

  constructor(ast: SelectAst, keyColumns: readonly ColumnMapping[]) {
    super();
    this.ast = ast;
    this.keyColumns = Object.freeze([...keyColumns]);
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Keyed>, run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
    const chunks = chunkKeys(this.#uniqueKeys(inputs.keys), KEY_LIMITS);
    const statementFor = (chunk: readonly StorageRow[]) => this.#statementFor(chunk);
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      for (const chunk of chunks) {
        yield* await run.query(statementFor(chunk)).toArray();
      }
    };
    return new AsyncIterableResult(generator());
  }

  #uniqueKeys(keys: readonly StorageRow[]): readonly StorageRow[] {
    const unique = new Map<string, StorageRow>();
    for (const key of keys) {
      const stitched = stitchKey(this.keyColumns.map(([source]) => key[source.alias]));
      if (!unique.has(stitched)) {
        unique.set(stitched, key);
      }
    }
    return [...unique.values()];
  }

  #statementFor(keys: readonly StorageRow[]): SelectAst {
    return withParentFilter(this.ast, anyOf(keys.map((key) => keyCondition(this.keyColumns, key))));
  }

  override withReturning(columns: readonly ProjectionItem[]): FindRelated {
    return new FindRelated(withColumnsThroughLayers(this.ast, columns), this.keyColumns);
  }
}

/** Adds the filter on the parents' identity beside the join to the parent table: in the innermost select, below every derived table that pages or removes duplicates. */
function withParentFilter(ast: SelectAst, filter: AnyExpression): SelectAst {
  const { from } = ast;
  if (from?.kind === 'derived-table-source') {
    return ast.withFrom(DerivedTableSource.as(from.alias, withParentFilter(from.query, filter)));
  }
  return ast.withWhere(
    combineWhereExprs([...(ast.where === undefined ? [] : [ast.where]), filter]),
  );
}

function withColumnsThroughLayers(ast: SelectAst, columns: readonly ProjectionItem[]): SelectAst {
  const { from } = ast;
  if (from?.kind !== 'derived-table-source') {
    return ast.withProjection(withColumns(ast.projection, columns));
  }
  const carried = columns.map((column) =>
    ProjectionItem.of(column.alias, ColumnRef.of(from.alias, column.alias), column.codec),
  );
  return ast
    .withFrom(DerivedTableSource.as(from.alias, withColumnsThroughLayers(from.query, columns)))
    .withProjection(withColumns(ast.projection, carried));
}
