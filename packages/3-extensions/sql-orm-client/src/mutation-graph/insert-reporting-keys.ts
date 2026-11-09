import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { InsertAst, ParamRef, ProjectionItem } from '@internal/sql-relational-core/ast';
import { type GeneratedKey, reportedInsertId, type WrittenRowOwner } from '../written-keys';
import type { StorageRow } from './edge';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import type { PayloadData } from './payload-data';
import { type Requires, requirementUnmet } from './requires';
import { rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type Inputs = { payload: PayloadData[]; state: StateEdge[]; requires: Requires[] };

/**
 * Inserts without `RETURNING` and reports the key of each row it inserted: the values the client wrote, those a `PayloadData` edge gives, and, for a one-row insert, the value the database generated, which the driver reports as `insertId`. When it reports none, the insert fails, so the transaction it runs in rolls back.
 */
export class InsertReportingKeys extends StatementNode<Inputs> {
  readonly slots = { payload: 'list', state: 'list', requires: 'list' } as const;
  readonly asts: readonly InsertAst[];
  readonly keys: readonly StorageRow[];
  readonly generated: GeneratedKey | undefined;
  readonly owner: WrittenRowOwner;

  constructor(
    asts: readonly InsertAst[],
    keys: readonly StorageRow[],
    generated: GeneratedKey | undefined,
    owner: WrittenRowOwner,
  ) {
    super();
    this.asts = Object.freeze([...asts]);
    this.keys = Object.freeze([...keys]);
    this.generated = generated;
    this.owner = owner;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return this.asts;
  }

  get returns(): readonly ProjectionItem[] {
    return [];
  }

  override execute(inputs: OutputsOf<Inputs>, run: Run): Executed {
    const payloads = inputs.payload ?? [];
    if (requirementUnmet(inputs.requires) || payloads.some((records) => records.length === 0)) {
      return rowsResult([]);
    }
    const record: Record<string, ParamRef> = Object.assign({}, ...payloads.map(([row]) => row));
    const asts = this.asts.map((ast) =>
      ast.withRows(ast.rows.map((row) => ({ ...row, ...record }))),
    );
    const keys = this.keys.map((key) =>
      Object.fromEntries(
        Object.entries(key).map(([column, value]) => [column, record[column]?.value ?? value]),
      ),
    );
    const { generated, owner } = this;
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      for (const ast of asts) {
        const stats = await run.execute(ast);
        if (generated !== undefined) {
          const insertId = reportedInsertId(stats, generated, owner);
          yield { ...keys[0], [generated.column]: await generated.decode(insertId) };
          return;
        }
      }
      yield* keys;
    };
    return new AsyncIterableResult(generator());
  }

  override withReturning(_columns: readonly ProjectionItem[]): InsertReportingKeys {
    return this;
  }
}
