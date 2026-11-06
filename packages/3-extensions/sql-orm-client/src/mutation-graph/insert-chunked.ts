import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  InsertAst,
  ProjectionItem,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import type { StorageRow } from './edge';
import { withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import { StatementNode } from './statement-node';

type NoInputs = Record<never, never>;

export class InsertChunked extends StatementNode<NoInputs> {
  readonly asts: readonly InsertAst[];

  constructor(asts: readonly InsertAst[]) {
    super();
    this.asts = Object.freeze([...asts]);
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.asts[0]?.returning ?? [];
  }

  override execute(_inputs: OutputsOf<NoInputs>, run: Run): Executed {
    if (this.returns.length === 0) {
      return this.#sumOfCounts(run);
    }
    const asts = this.asts;
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      for (const ast of asts) {
        yield* run.query(ast);
      }
    };
    return new AsyncIterableResult(generator());
  }

  override withReturning(columns: readonly ProjectionItem[]): InsertChunked {
    return new InsertChunked(
      this.asts.map((ast) => ast.withReturning(withColumns(ast.returning ?? [], columns))),
    );
  }

  async #sumOfCounts(run: Run): Promise<SqlStatementStats> {
    let affectedRows = 0;
    for (const ast of this.asts) {
      affectedRows += (await run.execute(ast)).affectedRows;
    }
    return { affectedRows };
  }
}
