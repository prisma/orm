import type { ProjectionItem, UpdateAst } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import type { PayloadData } from './payload-data';
import { requirementUnmet } from './requires';
import { rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

type Inputs = Filtered & { payload: PayloadData[] };

export class Update extends StatementNode<Inputs> {
  readonly slots = { filter: 'list', payload: 'list', state: 'list', requires: 'list' } as const;
  readonly ast: UpdateAst;

  constructor(ast: UpdateAst) {
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

  override execute(inputs: OutputsOf<Inputs>, run: Run): Executed {
    if (inputs.payload === null) {
      return executeFiltered(this.ast, inputs, run);
    }
    if (
      requirementUnmet(inputs.requires) ||
      inputs.payload.some((records) => records.length === 0)
    ) {
      return rowsResult([]);
    }
    const payload = Object.assign({}, ...inputs.payload.map(([record]) => record));
    return executeFiltered(this.ast.withSet({ ...this.ast.set, ...payload }), inputs, run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Update {
    return new Update(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
