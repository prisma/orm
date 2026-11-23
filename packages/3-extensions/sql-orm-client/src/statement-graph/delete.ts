import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { DeleteAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import type { StorageRow } from './edge';
import {
  executeFiltered,
  filteredWhere,
  type Linked,
  linkedSlots,
  withColumns,
} from './filtered-statement';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { givesOwnValues } from './own-values';
import { requirementUnmet } from './requires';
import { rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

export class Delete extends StatementNode<Linked> {
  readonly slots = linkedSlots;
  readonly ast: DeleteAst;

  constructor(ast: DeleteAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.returning ?? [];
  }

  override execute(inputs: OutputsOf<Linked>, run: Run): Executed {
    if (!givesOwnValues(run.context, this.returns)) {
      return executeFiltered(this.ast, inputs, run);
    }
    const filter = inputs.filter ?? [];
    const link = inputs.link ?? [];
    if (
      requirementUnmet(inputs.requires) ||
      [...filter, ...link].some((matches) => matches.length === 0)
    ) {
      return rowsResult([]);
    }
    const statement = this.ast
      .withWhere(filteredWhere(this.ast, filter, link))
      .withReturning(undefined);
    const keys = filter.flat().map(({ key }) => key);
    const returned = new Set(this.returns.map(({ alias }) => alias));
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      const { affectedRows } = await run.execute(statement);
      if (affectedRows === 0) {
        return;
      }
      for (const key of keys) {
        yield Object.fromEntries(Object.entries(key).filter(([column]) => returned.has(column)));
      }
    };
    return new AsyncIterableResult(generator());
  }

  override withReturning(columns: readonly ProjectionItem[]): Delete {
    return new Delete(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
