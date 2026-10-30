import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { ProjectionItem, type SelectAst } from '@internal/sql-relational-core/ast';
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

const KEY_ALIAS_PREFIX = '__written_key_';

/**
 * Reads the rows an insert wrote back by their keys, for a database without `RETURNING`, in the order the insert wrote them, and fails when one is not found, so the transaction rolls back.
 *
 * A `Find` with a `FilterData` edge cannot do this: the edge hands the `Find` conditions, not the key values, so the `Find` can neither put the rows in the insert's order nor tell which key found no row. This node reads the key values from a `Rows` edge, builds the same conditions a `FilterData` does, and selects each key column a second time under its own alias to match rows to keys.
 */
export class FindByKeys extends StatementNode<Keyed> {
  readonly ast: SelectAst;
  readonly keyColumns: readonly ColumnPair[];
  readonly missing: WrittenRowOwner;

  constructor(ast: SelectAst, keyColumns: readonly ColumnPair[], missing: WrittenRowOwner) {
    super();
    this.keyColumns = Object.freeze([...keyColumns]);
    this.ast = ast.withProjection(
      withColumns(
        ast.projection,
        keyColumns.map(([, target]) =>
          ProjectionItem.of(`${KEY_ALIAS_PREFIX}${target.alias}`, target.expr, target.codec),
        ),
      ),
    );
    this.missing = missing;
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
    const existing = this.ast.where === undefined ? [] : [this.ast.where];
    const matching = anyOf(keys.map((key) => keyCondition(this.keyColumns, key)));
    const ast = this.ast.withWhere(combineWhereExprs([...existing, matching]));
    const { keyColumns, missing } = this;
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      const found = new Map<string, StorageRow>();
      for (const row of await run.query(ast).toArray()) {
        found.set(
          keyText(keyColumns, row, ([, target]) => `${KEY_ALIAS_PREFIX}${target.alias}`),
          row,
        );
      }
      for (const key of keys) {
        const row = found.get(keyText(keyColumns, key, ([source]) => source.alias));
        if (row === undefined) {
          throw ormError(
            'ORM.MUTATION_ROW_MISSING',
            `${missing.operation}() for model "${missing.modelName}" did not find the row it wrote`,
            {
              meta: { operation: missing.operation, model: missing.modelName, phase: 'read-back' },
            },
          );
        }
        yield withoutKeyAliases(row);
      }
    };
    return new AsyncIterableResult(generator());
  }

  override withReturning(columns: readonly ProjectionItem[]): FindByKeys {
    return new FindByKeys(
      this.ast.withProjection(withColumns(this.returns, columns)),
      this.keyColumns,
      this.missing,
    );
  }
}

function keyText(
  columns: readonly ColumnPair[],
  row: StorageRow,
  aliasOf: (pair: ColumnPair) => string,
): string {
  return JSON.stringify(columns.map((pair) => valueText(row[aliasOf(pair)])));
}

function valueText(value: unknown): string {
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === 'bigint') return `bigint:${value}`;
  return JSON.stringify(value) ?? 'undefined';
}

function withoutKeyAliases(row: StorageRow): StorageRow {
  return Object.fromEntries(
    Object.entries(row).filter(([alias]) => !alias.startsWith(KEY_ALIAS_PREFIX)),
  );
}
