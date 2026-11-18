import type { DeleteAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { NodeId } from './edge';
import { executeFiltered, type Linked, linkedSlots, withColumns } from './filtered-statement';
import type { Graph } from './graph';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { StatementNode } from './statement-node';
import { writeWhere } from './write-where';

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
    return executeFiltered(this.ast, inputs, run);
  }

  override checkIfCanRun(_graph: Graph, _id: NodeId, context: ExecutionContext): void {
    writeWhere(context.contract, this.ast.table, this.ast.where);
  }

  override withReturning(columns: readonly ProjectionItem[]): Delete {
    return new Delete(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
