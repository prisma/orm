import { AsyncIterableResult } from '@internal/framework-components/runtime';
import {
  type AnyExpression,
  type DeleteAst,
  OrExpr,
  type ProjectionItem,
  type SelectAst,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { combineWhereExprs } from '../where-utils';
import type { Edge, FilterData, NodeId, StorageRow } from './edges';
import type { Graph } from './graph';

export type StatementAst = SelectAst | UpdateAst | DeleteAst;

export type Slots = Record<string, Edge<unknown>[]>;

type OutputOf<E> = E extends Edge<infer Output> ? Output : never;

export type OutputsOf<Inputs extends Slots> = {
  readonly [Slot in keyof Inputs]: readonly (readonly OutputOf<Inputs[Slot][number]>[])[] | null;
};

export type Executed = AsyncIterableResult<StorageRow> | Promise<number>;

export interface Run {
  query(ast: StatementAst): AsyncIterableResult<StorageRow>;
  execute(ast: StatementAst): Promise<number>;
}

export abstract class Node<Inputs extends Slots = Slots> {
  abstract readonly ast: StatementAst;
  abstract readonly returns: readonly ProjectionItem[];
  abstract readonly rowsAre: 'read' | 'written';

  abstract execute(inputs: OutputsOf<Inputs>, run: Run): Executed;

  abstract alsoReturning(columns: readonly ProjectionItem[]): Node<Inputs>;

  peephole(_graph: Graph, _id: NodeId): Node | undefined {
    return this;
  }
}

type Filtered = { filter: FilterData[] };

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

  override peephole(_graph: Graph, _id: NodeId): Node | undefined {
    return Object.keys(this.ast.set).length === 0 ? undefined : this;
  }
}

export class Delete extends Node<Filtered> {
  readonly ast: DeleteAst;
  readonly rowsAre = 'written';

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

  override alsoReturning(columns: readonly ProjectionItem[]): Delete {
    return new Delete(this.ast.withReturning(withColumns(this.returns, columns)));
  }
}

function executeFiltered(
  ast: StatementAst,
  filter: OutputsOf<Filtered>['filter'],
  run: Run,
): Executed {
  if (filter === null) {
    return executeStatement(ast, run);
  }
  if (filter.some((conditions) => conditions.length === 0)) {
    return noRows();
  }
  const existing = ast.where === undefined ? [] : [ast.where];
  const where = combineWhereExprs([...existing, ...filter.map(anyOf)]);
  return executeStatement(ast.withWhere(where), run);
}

function executeStatement(ast: StatementAst, run: Run): Executed {
  return ast.kind === 'select' || ast.returning !== undefined ? run.query(ast) : run.execute(ast);
}

function anyOf(conditions: readonly AnyExpression[]): AnyExpression {
  const [first, ...others] = conditions;
  return first !== undefined && others.length === 0 ? first : OrExpr.of(conditions);
}

function withColumns(
  returned: readonly ProjectionItem[],
  columns: readonly ProjectionItem[],
): readonly ProjectionItem[] {
  const present = new Set(returned.map((item) => item.alias));
  return [...returned, ...columns.filter((column) => !present.has(column.alias))];
}

function noRows(): AsyncIterableResult<StorageRow> {
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {};
  return new AsyncIterableResult(generator());
}
