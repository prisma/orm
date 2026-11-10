import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  InsertAst,
  InsertValue,
  ProjectionItem,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { hasContractCapability } from '../collection-contract';
import {
  type GeneratedKey,
  generatedKey,
  reportedInsertId,
  type WrittenRowOwner,
} from '../written-keys';
import { DataEdge, type NodeId, type StorageRow } from './edge';
import type { Graph } from './graph';
import type { Run } from './node';

export function givesOwnValues(
  context: ExecutionContext,
  returns: readonly ProjectionItem[],
): boolean {
  return returns.length > 0 && !hasContractCapability(context.contract, 'returning');
}

export function checkOwnValues(
  graph: Graph,
  id: NodeId,
  context: ExecutionContext,
  asts: readonly InsertAst[],
  returns: readonly ProjectionItem[],
  owner: WrittenRowOwner,
): void {
  if (!givesOwnValues(context, returns)) {
    return;
  }
  const given = [graph.inputsOf(id)['payload'] ?? []]
    .flat()
    .flatMap((edge) => (edge instanceof DataEdge ? edge.columns.map(([, target]) => target) : []));
  generatedKeyOf(context, asts, returns, owner, given);
}

export function insertGivingOwnValues(
  asts: readonly InsertAst[],
  returns: readonly ProjectionItem[],
  owner: WrittenRowOwner,
  run: Run,
): AsyncIterableResult<StorageRow> {
  const generated = generatedKeyOf(run.context, asts, returns, owner, []);
  const generator = async function* (): AsyncGenerator<StorageRow, void, unknown> {
    for (const ast of asts) {
      const stats = await run.execute(ast.withReturning(undefined));
      const generatedValues =
        generated === undefined
          ? {}
          : {
              [generated.column]: await generated.decode(reportedInsertId(stats, generated, owner)),
            };
      for (const row of ast.rows) {
        const values = { ...valuesOf(row), ...generatedValues };
        yield Object.fromEntries(returns.map((column) => [column.alias, values[column.alias]]));
      }
    }
  };
  return new AsyncIterableResult(generator());
}

function generatedKeyOf(
  context: ExecutionContext,
  asts: readonly InsertAst[],
  returns: readonly ProjectionItem[],
  owner: WrittenRowOwner,
  given: readonly ProjectionItem[],
): GeneratedKey | undefined {
  const [first] = asts;
  if (first === undefined) {
    return undefined;
  }
  const givenValues = Object.fromEntries(given.map((column) => [column.alias, true]));
  return generatedKey({
    context,
    ...storageOf(first.table),
    modelName: owner.modelName,
    method: `${owner.operation}()`,
    rows: asts.flatMap((ast) => ast.rows.map((row) => ({ ...valuesOf(row), ...givenValues }))),
    columns: returns.map((column) => column.alias),
  });
}

function valuesOf(row: Readonly<Record<string, InsertValue>>): StorageRow {
  return Object.fromEntries(
    Object.entries(row).flatMap(([column, value]) =>
      value.kind === 'param-ref' ? [[column, value.value]] : [],
    ),
  );
}

function storageOf(table: TableSource): { namespaceId: string; tableName: string } {
  return {
    namespaceId: blindCast<
      string,
      'The ORM builds every table source with tableSourceForContract, which sets the namespace'
    >(table.namespaceId),
    tableName: table.name,
  };
}
