import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { ProjectionItem, SelectAst } from '@internal/sql-relational-core/ast';
import { ormError } from '../orm-errors';
import { combineWhereExprs } from '../where-utils';
import type { WrittenRowOwner } from '../written-keys';
import type { ColumnMapping, StorageRow } from './edge';
import { keyCondition } from './filter-data';
import { anyOf, withColumns } from './filtered-statement';
import { chunkKeys } from './key-chunks';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { type Requires, requirementUnmet } from './requires';
import type { Rows } from './rows';
import { rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type Keyed = { keys: Rows; state: StateEdge[]; requires: Requires[] };

const KEYS_PER_STATEMENT = 500;

/**
 * Reads the rows a write wrote back by their keys, for a database without `RETURNING`, in no particular order, and fails when it finds fewer rows than keys, so the transaction rolls back. It reads at most 500 keys per statement.
 *
 * A `Find` with a `FilterData` edge reads the same rows, but it neither checks that every key was found nor splits the keys across statements.
 */
export class FindByKeys extends StatementNode<Keyed> {
  readonly slots = { keys: 'one', state: 'list', requires: 'list' } as const;
  readonly ast: SelectAst;
  readonly keyColumns: readonly ColumnMapping[];
  readonly owner: WrittenRowOwner;
  readonly missing: Error | undefined;

  constructor(
    ast: SelectAst,
    keyColumns: readonly ColumnMapping[],
    owner: WrittenRowOwner,
    missing?: Error,
  ) {
    super();
    this.ast = ast;
    this.keyColumns = Object.freeze([...keyColumns]);
    this.owner = owner;
    this.missing = missing;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Keyed>, run: Run): Executed {
    const keys = inputs.keys;
    if (requirementUnmet(inputs.requires) || keys.length === 0) {
      return rowsResult([]);
    }
    const chunks = chunkKeys(keys, {
      parameters: KEYS_PER_STATEMENT * this.keyColumns.length,
      bytes: Number.POSITIVE_INFINITY,
    });
    const { owner, missing } = this;
    const statementFor = (chunk: readonly StorageRow[]) => this.#statementFor(chunk);
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      for (const chunk of chunks) {
        const rows = await run.query(statementFor(chunk)).toArray();
        if (rows.length < chunk.length) {
          throw (
            missing ??
            ormError(
              'ORM.MUTATION_ROW_MISSING',
              `${owner.operation}() for model "${owner.modelName}" did not find the row it wrote`,
              { meta: { operation: owner.operation, model: owner.modelName, phase: 'read-back' } },
            )
          );
        }
        yield* rows;
      }
    };
    return new AsyncIterableResult(generator());
  }

  #statementFor(keys: readonly StorageRow[]): SelectAst {
    const conditions = keys.map((key) => keyCondition(this.keyColumns, key));
    const existing = this.ast.where === undefined ? [] : [this.ast.where];
    return this.ast.withWhere(combineWhereExprs([...existing, anyOf(conditions)]));
  }

  override withReturning(columns: readonly ProjectionItem[]): FindByKeys {
    return new FindByKeys(
      this.ast.withProjection(withColumns(this.returns, columns)),
      this.keyColumns,
      this.owner,
      this.missing,
    );
  }
}
