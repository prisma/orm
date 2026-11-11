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
import { ormError } from '../orm-errors';
import {
  type GeneratedKey,
  generatedKey,
  reportedInsertId,
  rowIdentity,
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
  const [first] = asts;
  if (first === undefined) {
    return;
  }
  const { namespaceId, tableName } = storageOf(first.table);
  const method = `${owner.operation}()`;
  if (asts.some((ast) => ast.onConflict?.action.kind === 'do-nothing')) {
    throw ormError(
      'ORM.CAPABILITY_MISSING',
      `${method} with onConflict "skip" on model "${owner.modelName}" requires contract capability "returning": without it the rows are read back by key, which finds a skipped row's existing match. Use createAndCount() to skip conflicting rows.`,
      { meta: { capability: 'returning', action: method } },
    );
  }
  rowIdentity(context.contract, namespaceId, tableName, owner.modelName, method);
  const given = [graph.inputsOf(id)['payload'] ?? []]
    .flat()
    .flatMap((edge) => (edge instanceof DataEdge ? edge.columns.map(([, target]) => target) : []));
  for (const ast of asts) {
    refuseUpsertOfColumnsReadBack(ast, returns, owner);
  }
  generatedKeyOf(context, asts, returns, owner, given);
}

function refuseUpsertOfColumnsReadBack(
  ast: InsertAst,
  returns: readonly ProjectionItem[],
  owner: WrittenRowOwner,
): void {
  const action = ast.onConflict?.action;
  if (action?.kind !== 'do-update-set') {
    return;
  }
  const method = `${owner.operation}()`;
  const refused = (problem: string) =>
    ormError(
      'ORM.CAPABILITY_MISSING',
      `${method} on model "${owner.modelName}" ${problem}; without capability "returning" the row is read back by the create's values for the conflict columns.`,
      { meta: { capability: 'returning', action: method } },
    );
  const read = returns.map((column) => column.alias);
  const updated = read.filter((column) => {
    const value = action.set[column];
    return (
      value !== undefined &&
      !(value.kind === 'column-ref' && value.table === 'excluded' && value.column === column)
    );
  });
  if (updated.length > 0) {
    throw refused(`updates conflict column "${updated.join('", "')}"`);
  }
  const absent = read.filter((column) => ast.rows.some((row) => row[column]?.kind !== 'param-ref'));
  if (absent.length > 0) {
    throw refused(`gives conflict column "${absent.join('", "')}" no create value`);
  }
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
