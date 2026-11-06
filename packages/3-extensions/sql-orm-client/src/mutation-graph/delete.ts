import type { DeleteAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import { StatementNode } from './statement-node';

export class Delete extends StatementNode<Filtered> {
  readonly ast: DeleteAst;

  constructor(ast: DeleteAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.returning ?? [];
  }

  override execute(inputs: OutputsOf<Filtered>, run: Run): Executed {
    return executeFiltered(this.ast, inputs.filter, run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Delete {
    return new Delete(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
