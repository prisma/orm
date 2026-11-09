import type { Contract } from '@internal/contract/types';
import type { ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
import { cachedFor } from '../contract-cache';
import type { TableStorageCoordinate } from '../table-scope';

export type WriteKind = 'insert' | 'update' | 'delete';

type ChangeKind = Exclude<WriteKind, 'insert'>;

interface Referencing {
  readonly table: TableStorageCoordinate;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
}

interface Step {
  readonly table: TableStorageCoordinate;
  readonly kind: ChangeKind;
}

export function tableKey(table: TableStorageCoordinate): string {
  return JSON.stringify([table.namespaceId, table.tableName]);
}

export function changedBy(
  contract: Contract<SqlStorage>,
  write: WriteKind,
  table: TableStorageCoordinate,
): readonly TableStorageCoordinate[] {
  if (write === 'insert') {
    return [table];
  }
  return cachedFor(contract, ['changedBy', write, table.namespaceId, table.tableName], () => {
    const changed = new Map([[tableKey(table), table]]);
    const visited = new Set([stepKey({ table, kind: write })]);
    const pending: Step[] = [{ table, kind: write }];
    for (let step = pending.shift(); step !== undefined; step = pending.shift()) {
      for (const reference of referencesTo(contract, step.table)) {
        const next = nextStep(step.kind, reference);
        if (next !== undefined && !visited.has(stepKey(next))) {
          visited.add(stepKey(next));
          changed.set(tableKey(next.table), next.table);
          pending.push(next);
        }
      }
    }
    return Object.freeze([...changed.values()]);
  });
}

function referencesTo(
  contract: Contract<SqlStorage>,
  target: TableStorageCoordinate,
): Referencing[] {
  return Object.entries(contract.storage.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.entries.table ?? {}).flatMap(([tableName, table]) =>
      table.foreignKeys
        .filter(
          (foreignKey) =>
            foreignKey.target.namespaceId === target.namespaceId &&
            foreignKey.target.tableName === target.tableName,
        )
        .map((foreignKey) => ({
          table: { namespaceId, tableName },
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
        })),
    ),
  );
}

function nextStep(kind: ChangeKind, reference: Referencing): Step | undefined {
  const action = kind === 'delete' ? reference.onDelete : reference.onUpdate;
  switch (action) {
    case 'cascade':
      return { table: reference.table, kind };
    case 'setNull':
    case 'setDefault':
      return { table: reference.table, kind: 'update' };
    default:
      return undefined;
  }
}

function stepKey(step: Step): string {
  return JSON.stringify([step.kind, step.table.namespaceId, step.table.tableName]);
}
