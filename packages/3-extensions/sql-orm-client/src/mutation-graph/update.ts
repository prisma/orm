import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { ProjectionItem, UpdateAst } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { hasContractCapability } from '../collection-contract';
import { ormError } from '../orm-errors';
import type { WrittenRowOwner } from '../written-keys';
import type { NodeId, StorageRow } from './edge';
import { executeFiltered, type Filtered, filteredWhere, withColumns } from './filtered-statement';
import type { Graph } from './graph';
import type { Executed, OutputsOf, Run, StatementAst } from './node';
import { givesOwnValues } from './own-values';
import type { PayloadData } from './payload-data';
import { requirementUnmet } from './requires';
import { rowsResult } from './run-statement';
import { StatementNode } from './statement-node';

type Inputs = Filtered & { payload: PayloadData[] };

export class Update extends StatementNode<Inputs> {
  readonly slots = { filter: 'list', payload: 'list', state: 'list', requires: 'list' } as const;
  readonly ast: UpdateAst;
  readonly owner: WrittenRowOwner;

  constructor(ast: UpdateAst, owner: WrittenRowOwner) {
    super();
    this.ast = ast;
    this.owner = owner;
    Object.freeze(this);
  }

  get statements(): readonly StatementAst[] {
    return [this.ast];
  }

  get returns(): readonly ProjectionItem[] {
    return this.ast.returning ?? [];
  }

  override execute(inputs: OutputsOf<Inputs>, run: Run): Executed {
    if (inputs.payload === null) {
      return this.#run(this.ast, inputs, run);
    }
    if (
      requirementUnmet(inputs.requires) ||
      inputs.payload.some((records) => records.length === 0)
    ) {
      return rowsResult([]);
    }
    const payload = Object.assign({}, ...inputs.payload.map(([record]) => record));
    return this.#run(this.ast.withSet({ ...this.ast.set, ...payload }), inputs, run);
  }

  override check(graph: Graph, id: NodeId, context: ExecutionContext): void {
    if (hasContractCapability(context.contract, 'returning')) {
      return;
    }
    const read = new Set(graph.columnsReadFrom(id).map((column) => column.alias));
    const [column] = Object.entries(this.ast.set)
      .filter(([name, value]) => read.has(name) && value.kind !== 'param-ref')
      .map(([name]) => name);
    if (column === undefined) {
      return;
    }
    const action = `${this.owner.operation}()`;
    throw ormError(
      'ORM.CAPABILITY_MISSING',
      `${action} on model "${this.owner.modelName}" cannot read back the rows it updates: it sets key column "${column}" by an expression, and without capability "returning" the database does not report the value it wrote.`,
      { meta: { capability: 'returning', action } },
    );
  }

  override withReturning(columns: readonly ProjectionItem[]): Update {
    return new Update(this.ast.withReturning(withColumns(this.returns, columns)), this.owner);
  }

  #run(ast: UpdateAst, inputs: OutputsOf<Inputs>, run: Run): Executed {
    if (!givesOwnValues(run.context, this.returns)) {
      return executeFiltered(ast, inputs, run);
    }
    const { filter } = inputs;
    if (requirementUnmet(inputs.requires) || filter?.some((matches) => matches.length === 0)) {
      return rowsResult([]);
    }
    const statement = ast
      .withWhere(filter === null ? ast.where : filteredWhere(ast.where, filter))
      .withReturning(undefined);
    const set = Object.fromEntries(
      Object.entries(ast.set).flatMap(([column, value]) =>
        value.kind === 'param-ref' ? [[column, value.value]] : [],
      ),
    );
    const keys = (filter ?? []).flat().map(({ key }) => key);
    const { returns } = this;
    const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
      await run.execute(statement);
      for (const key of keys) {
        const values: StorageRow = { ...key, ...set };
        yield Object.fromEntries(returns.map((column) => [column.alias, values[column.alias]]));
      }
    };
    return new AsyncIterableResult(generator());
  }
}
