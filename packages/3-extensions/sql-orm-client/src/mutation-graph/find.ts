import type { ProjectionItem, SelectAst } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, withColumns } from './filtered-statement';
import { type Executed, Node, type OutputsOf, type Run } from './node';

export class Find extends Node<Filtered> {
  readonly ast: SelectAst;
  readonly rowsAre = 'read';

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

  override alsoReturning(columns: readonly ProjectionItem[]): Find {
    return new Find(this.ast.withProjection(withColumns(this.returns, columns)));
  }
}
