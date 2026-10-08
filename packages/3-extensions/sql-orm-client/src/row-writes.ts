import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { ifDefined } from '@internal/utils/defined';
import { compileInsertReturning } from './query-plan';
import { queryPlanRows } from './query-plan-rows';

export function applyCreateDefaults(
  context: ExecutionContext,
  namespaceId: string,
  tableName: string,
  rows: Record<string, unknown>[],
  defaultValueCache?: Map<string, unknown>,
): void {
  for (const row of rows) {
    const applied = context.applyMutationDefaults({
      op: 'create',
      entry: tableName,
      namespace: namespaceId,
      values: row,
      ...ifDefined('defaultValueCache', defaultValueCache),
    });
    for (const def of applied) {
      row[def.field] = def.value;
    }
  }
}

export function applyUpdateDefaults(
  context: ExecutionContext,
  namespaceId: string,
  tableName: string,
  values: Record<string, unknown>,
): void {
  const applied = context.applyMutationDefaults({
    op: 'update',
    entry: tableName,
    namespace: namespaceId,
    values,
  });
  for (const def of applied) {
    values[def.field] = def.value;
  }
}

export async function insertRowReturning(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  tableName: string,
  row: Record<string, unknown>,
  defaultValueCache?: Map<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  applyCreateDefaults(context, namespaceId, tableName, [row], defaultValueCache);
  const compiled = compileInsertReturning(
    context.contract,
    namespaceId,
    tableName,
    [row],
    undefined,
  );
  const rows = await queryPlanRows<Record<string, unknown>>(scope, compiled).toArray();
  return rows[0];
}
