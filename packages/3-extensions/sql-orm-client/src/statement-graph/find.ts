import type { ProjectionItem, SelectAst } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Linked, linkedSlots, withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { StatementNode } from './statement-node';

export class Find extends StatementNode<Linked> {
  readonly slots = linkedSlots;
  readonly ast: SelectAst;

  constructor(ast: SelectAst) {
    super();
    this.ast = ast;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.projection;
  }

  override execute(inputs: OutputsOf<Linked>, run: Run): Executed {
    return executeFiltered(this.ast, inputs, run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Find {
    return new Find(this.ast.withProjection(withColumns(this.returns, columns)));
  }
}
