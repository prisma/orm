import type { InsertAst, ProjectionItem } from '@internal/sql-relational-core/ast';
import { ormError } from '../orm-errors';
import { withColumns } from './filtered-statement';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import type { Payload, PayloadData } from './payload-data';
import { type Requires, requirementUnmet } from './requires';
import { executeStatement, rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type Payloads = { payload: PayloadData[]; state: StateEdge[]; requires: Requires[] };

export interface InsertJunction {
  readonly relation: string;
  readonly junction: string;
}

export class Insert extends StatementNode<Payloads> {
  readonly slots = { payload: 'list', state: 'list', requires: 'list' } as const;
  readonly ast: InsertAst;
  readonly junction: InsertJunction | undefined;

  constructor(ast: InsertAst, junction?: InsertJunction) {
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

  override execute(inputs: OutputsOf<Payloads>, run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
    // No PayloadData edge reaches this insert, so it runs with the values it was built with.
    if (inputs.payload === null) {
      return executeStatement(this.ast, run);
    }
    // A PayloadData source produced no rows, so there are no values to insert with: nothing is inserted and the statement is not run.
    if (inputs.payload.some((records) => records.length === 0)) {
      return rowsResult([]);
    }
    const records = inputs.payload.map(([record]) => record);
    if (this.junction !== undefined) {
      assertNoConflictingColumn(records, this.junction);
    }
    const payload = Object.assign({}, ...records);
    const rows = this.ast.rows.map((row) => ({ ...row, ...payload }));
    return executeStatement(this.ast.withRows(rows), run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Insert {
    return new Insert(this.ast.withReturning(withColumns(this.returns, columns)), this.junction);
  }
}

function assertNoConflictingColumn(
  records: readonly (Payload | undefined)[],
  { relation, junction }: InsertJunction,
): void {
  const seen = new Map<string, unknown>();
  for (const record of records) {
    for (const [column, param] of Object.entries(record ?? {})) {
      if (seen.has(column) && !Object.is(seen.get(column), param.value)) {
        throw ormError(
          'ORM.RELATION_MUTATION_INVALID',
          `Cannot write junction "${junction}": conflicting values for junction column "${column}"`,
          { meta: { relation, junction, column } },
        );
      }
      seen.set(column, param.value);
    }
  }
}
