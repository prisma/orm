import type { ProjectionItem, UpdateAst } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, withColumns } from './filtered-statement';
import { type Executed, Node, type OutputsOf, type Run } from './node';

export class Update extends Node<Filtered> {
  readonly ast: UpdateAst;
  readonly rowsAre = 'written';

  constructor(ast: UpdateAst) {
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

  override alsoReturning(columns: readonly ProjectionItem[]): Update {
    return new Update(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}
