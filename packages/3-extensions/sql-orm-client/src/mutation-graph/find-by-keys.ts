import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  CaseExpr,
  LiteralExpr,
  OrderByItem,
  type ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { ormError } from '../orm-errors';
import { combineWhereExprs } from '../where-utils';
import type { WrittenRowOwner } from '../written-keys';
import type { ColumnPair, StorageRow } from './edge';
import { keyCondition } from './filter-data';
import { anyOf, withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

type Keyed = { keys: Rows };

/**
 * Reads the rows an insert wrote back by their keys, for a database without `RETURNING`, in the order the insert wrote them, and fails when it finds fewer rows than keys, so the transaction rolls back.
 *
 * A `Find` with a `FilterData` edge cannot do this: the edge hands the `Find` conditions, not the key values, so the `Find` cannot order the rows by key or count the keys. The database does both comparisons, with its own rules for collation and precision: each key's condition both selects its row and, in an `ORDER BY CASE`, places it.
 */
export class FindByKeys extends StatementNode<Keyed> {
  readonly ast: SelectAst;
  readonly keyColumns: readonly ColumnPair[];
  readonly owner: WrittenRowOwner;

  constructor(ast: SelectAst, keyColumns: readonly ColumnPair[], owner: WrittenRowOwner) {
    super();
    this.ast = ast;
    this.keyColumns = Object.freeze([...keyColumns]);
    this.owner = owner;
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Keyed>, run: Run): Executed {
    const keys = inputs.keys;
    if (keys.length === 0) {
      return rowsResult([]);
    }
    const conditions = keys.map((key) => keyCondition(this.keyColumns, key));
    const existing = this.ast.where === undefined ? [] : [this.ast.where];
    const found = this.ast.withWhere(combineWhereExprs([...existing, anyOf(conditions)]));
    const ast =
      conditions.length === 1
        ? found
        : found.withOrderBy([
            OrderByItem.asc(
              CaseExpr.of(
                conditions.map((condition, position) => ({
                  condition,
                  value: LiteralExpr.of(position),
                })),
              ),
            ),
          ]);
    const { owner } = this;
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      const rows = await run.query(ast).toArray();
      if (rows.length < keys.length) {
        throw ormError(
          'ORM.MUTATION_ROW_MISSING',
          `${owner.operation}() for model "${owner.modelName}" did not find the row it wrote`,
          { meta: { operation: owner.operation, model: owner.modelName, phase: 'read-back' } },
        );
      }
      yield* rows;
    };
    return new AsyncIterableResult(generator());
  }

  override withReturning(columns: readonly ProjectionItem[]): FindByKeys {
    return new FindByKeys(
      this.ast.withProjection(withColumns(this.returns, columns)),
      this.keyColumns,
      this.owner,
    );
  }
}
