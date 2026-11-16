import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { ProjectionItem, SelectAst } from '@internal/sql-relational-core/ast';
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

/**
 * Reads the child rows of an include for every parent at once, by the parents' keys. It sends each key once, in chunks of at most 10 000 bound parameters and an estimated 1 MiB of key values, and concatenates the rows of the chunks in order.
 */
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
    const conditions = keys.map((key) => keyCondition(this.keyColumns, key));
    const existing = this.ast.where === undefined ? [] : [this.ast.where];
    return this.ast.withWhere(combineWhereExprs([...existing, anyOf(conditions)]));
  }

  override withReturning(columns: readonly ProjectionItem[]): FindRelated {
    return new FindRelated(
      this.ast.withProjection(withColumns(this.returns, columns)),
      this.keyColumns,
    );
  }
}
