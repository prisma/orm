import type { InsertAst, ParamRef, ProjectionItem } from '@internal/sql-relational-core/ast';
import { withColumns } from './filtered-statement';
import { assertOneValuePerColumn, type JunctionWrite } from './junction-write';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import type { PayloadData } from './payload-data';
import { type Requires, requirementUnmet } from './requires';
import { executeStatement, rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type Payloads = { payload: PayloadData[]; state: StateEdge[]; requires: Requires[] };

type Payload = Readonly<Record<string, ParamRef>>;

export class Insert extends StatementNode<Payloads> {
  readonly slots = { payload: 'list', state: 'list', requires: 'list' } as const;
  readonly ast: InsertAst;
  readonly junction: JunctionWrite | undefined;

  constructor(ast: InsertAst, junction?: JunctionWrite) {
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
    return executeStatement(withPayload(this.ast, payloadOf(inputs.payload, this.junction)), run);
  }

  override withReturning(columns: readonly ProjectionItem[]): Insert {
    return new Insert(this.ast.withReturning(withColumns(this.returns, columns)), this.junction);
  }
}

/** The values the `PayloadData` edges give every row, each edge's first record. */
export function payloadOf(
  payload: readonly (readonly Payload[])[],
  junction: JunctionWrite | undefined,
): Payload {
  const records = payload.map(([record]) => record ?? {});
  if (junction !== undefined) {
    assertOneValuePerColumn(
      records.flatMap((record) =>
        Object.entries(record).map(([column, param]) => [column, param.value] as const),
      ),
      junction,
    );
  }
  return Object.assign({}, ...records);
}

export function withPayload(ast: InsertAst, payload: Payload): InsertAst {
  return ast.withRows(ast.rows.map((row) => ({ ...row, ...payload })));
}
