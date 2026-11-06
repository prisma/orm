import type { ProjectionItem, SelectAst } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run } from './node';
import { StatementNode } from './statement-node';

export class Find extends StatementNode<Filtered> {
  readonly ast: SelectAst;

  constructor(ast: SelectAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Filtered>, run: Run): Executed {
    return executeFiltered(this.ast, inputs.filter, run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Find {
    return new Find(this.ast.withProjection(withColumns(this.returns, columns)));
  }
}
