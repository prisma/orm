import type { AnyExpression, DeleteAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import { executeFiltered, type Filtered, filteredSlots, withColumns } from './filtered-statement';
import { assertOneValuePerColumn, type JunctionWrite } from './junction-write';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { StatementNode } from './statement-node';

export class Delete extends StatementNode<Filtered> {
  readonly slots = filteredSlots;
  readonly ast: DeleteAst;
  readonly junction: JunctionWrite | undefined;

  constructor(ast: DeleteAst, junction?: JunctionWrite) {
    super();
    this.ast = ast;
    this.junction = junction;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.returning ?? [];
  }

  override execute(inputs: OutputsOf<Filtered>, run: Run): Executed {
    if (this.junction !== undefined) {
      assertOneValuePerColumn((inputs.filter ?? []).flat().flatMap(columnValues), this.junction);
    }
    return executeFiltered(this.ast, inputs, run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Delete {
    return new Delete(this.ast.withReturning(withColumns(this.returns, columns)), this.junction);
  }
}

function columnValues(condition: AnyExpression): (readonly [string, unknown])[] {
  if (condition.kind === 'and') {
    return condition.exprs.flatMap(columnValues);
  }
  return condition.kind === 'binary' &&
    condition.op === 'eq' &&
    condition.left.kind === 'column-ref' &&
    condition.right.kind === 'param-ref'
    ? [[condition.left.column, condition.right.value]]
    : [];
}
