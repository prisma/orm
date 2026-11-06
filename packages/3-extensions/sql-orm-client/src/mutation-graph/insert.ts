import type { InsertAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import { withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import type { PayloadData } from './payload-data';
import { executeStatement, rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

type Payloads = { payload: PayloadData[] };

export class Insert extends StatementNode<Payloads> {
  readonly ast: InsertAst;

  constructor(ast: InsertAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.returning ?? [];
  }

  override execute(inputs: OutputsOf<Payloads>, run: Run): Executed {
    // No PayloadData edge reaches this insert, so it runs with the values it was built with.
    if (inputs.payload === null) {
      return executeStatement(this.ast, run);
    }
    // A PayloadData source produced no rows, so there are no values to insert with: nothing is inserted and the statement is not run.
    if (inputs.payload.some((records) => records.length === 0)) {
      return rowsResult([]);
    }
    const payload = Object.assign({}, ...inputs.payload.map(([record]) => record));
    const rows = this.ast.rows.map((row) => ({ ...row, ...payload }));
    return executeStatement(this.ast.withRows(rows), run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Insert {
    return new Insert(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
