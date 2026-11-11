import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  InsertAst,
  ParamRef,
  ProjectionItem,
  SqlStatementStats,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { WrittenRowOwner } from '../written-keys';
import type { NodeId, StorageRow } from './edge';
import { withColumns } from './filtered-statement';
import type { Graph } from './graph';
import { assertOneValuePerColumn, type JunctionWrite } from './junction-write';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { checkOwnValues, givesOwnValues, insertGivingOwnValues } from './own-values';
import type { PayloadData } from './payload-data';
import { type Requires, requirementUnmet } from './requires';
import { executeStatement, rowsResult } from './run-statement';
import type { StateEdge } from './state';
import { StatementNode } from './statement-node';

type Payloads = { payload: PayloadData[]; state: StateEdge[]; requires: Requires[] };

type Payload = Readonly<Record<string, ParamRef>>;

export class Insert extends StatementNode<Payloads> {
  readonly slots = { payload: 'list', state: 'list', requires: 'list' } as const;
  readonly asts: readonly InsertAst[];
  readonly owner: WrittenRowOwner;
  readonly junction: JunctionWrite | undefined;

  constructor(asts: readonly InsertAst[], owner: WrittenRowOwner, junction?: JunctionWrite) {
    super();
    this.asts = Object.freeze([...asts]);
    this.owner = owner;
    this.junction = junction;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return this.asts;
  }

  get returns(): readonly ProjectionItem[] {
    return this.asts[0]?.returning ?? [];
  }

  override execute(inputs: OutputsOf<Payloads>, run: Run): Executed {
    if (requirementUnmet(inputs.requires)) {
      return rowsResult([]);
    }
    if (inputs.payload?.some((records) => records.length === 0)) {
      return rowsResult([]);
    }
    const payload = inputs.payload === null ? undefined : payloadOf(inputs.payload, this.junction);
    const asts =
      payload === undefined ? this.asts : this.asts.map((ast) => withPayload(ast, payload));
    const [only, ...others] = asts;
    if (givesOwnValues(run.context, this.returns)) {
      return insertGivingOwnValues(asts, this.returns, this.owner, run);
    }
    if (only !== undefined && others.length === 0) {
      return executeStatement(only, run);
    }
    if (this.returns.length === 0) {
      return sumOfCounts(asts, run);
    }
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      for (const ast of asts) {
        yield* run.query(ast);
      }
    };
    return new AsyncIterableResult(generator());
  }

  override check(graph: Graph, id: NodeId, context: ExecutionContext): void {
    checkOwnValues(graph, id, context, this.asts, this.returns, this.owner);
  }

  override withReturning(columns: readonly ProjectionItem[]): Insert {
    return new Insert(
      this.asts.map((ast) => ast.withReturning(withColumns(ast.returning ?? [], columns))),
      this.owner,
      this.junction,
    );
  }
}

async function sumOfCounts(asts: readonly InsertAst[], run: Run): Promise<SqlStatementStats> {
  let affectedRows = 0;
  for (const ast of asts) {
    affectedRows += (await run.execute(ast)).affectedRows;
  }
  return { affectedRows };
}

function payloadOf(
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

function withPayload(ast: InsertAst, payload: Payload): InsertAst {
  return ast.withRows(ast.rows.map((row) => ({ ...row, ...payload })));
}
