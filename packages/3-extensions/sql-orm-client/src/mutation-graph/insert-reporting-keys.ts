import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { InsertAst } from '@internal/sql-relational-core/ast';
import { type GeneratedKey, reportedInsertId, type WrittenRowOwner } from '../written-keys';
import type { StorageRow } from './edge';
import { type Executed, Node, type OutputsOf, type Run } from './node';

type NoInputs = Record<never, never>;

/**
 * Inserts without `RETURNING` and reports the key of each row it inserted: the values the client wrote, and, for a one-row insert, the value the database generated, which the driver reports as `insertId`. When it reports none, the insert fails, so the transaction it runs in rolls back.
 */
export class InsertReportingKeys extends Node<NoInputs> {
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

  override execute(_inputs: OutputsOf<NoInputs>, run: Run): Executed {
    const { asts, keys, generated, owner } = this;
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
}
