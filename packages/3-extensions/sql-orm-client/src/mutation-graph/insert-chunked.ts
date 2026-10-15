import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { InsertAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import type { StorageRow } from './edge';
import { withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { type Requires, requirementUnmet } from './requires';
import { rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type StateOnly = { state: StateEdge[]; requires: Requires[] };

export class InsertChunked extends StatementNode<StateOnly> {
  readonly slots = { state: 'list', requires: 'list' } as const;
  readonly asts: readonly InsertAst[];

  constructor(asts: readonly InsertAst[]) {
    super();
    this.asts = Object.freeze([...asts]);
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return this.asts;
  }

  get returns(): readonly ProjectionItem[] {
    return this.asts[0]?.returning ?? [];
  }

  override execute(inputs: OutputsOf<StateOnly>, run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
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

  async #sumOfCounts(run: Run): Promise<number> {
    let count = 0;
    for (const ast of this.asts) {
      count += await run.execute(ast);
    }
    return count;
  }
}
