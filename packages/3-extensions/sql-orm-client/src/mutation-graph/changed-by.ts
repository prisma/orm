import type { Contract } from '@internal/contract/types';
import type { ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
import type { TableCoordinate } from '@internal/sql-relational-core/ast';

export type WriteKind = 'insert' | 'update' | 'delete';

interface Referencing {
  readonly table: TableCoordinate;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
}

const changingActions: ReadonlySet<ReferentialAction | undefined> = new Set([
  'cascade',
  'setNull',
  'setDefault',
]);

const referencingByContract = new WeakMap<
  Contract<SqlStorage>,
  ReadonlyMap<string, readonly Referencing[]>
>();

export function tableKey(table: TableCoordinate): string {
  return JSON.stringify([table.namespaceId, table.name]);
}

function referencingOf(
  contract: Contract<SqlStorage>,
): ReadonlyMap<string, readonly Referencing[]> {
  const known = referencingByContract.get(contract);
  if (known !== undefined) {
    return known;
  }
  const referencing = new Map<string, Referencing[]>();
  for (const [namespaceId, namespace] of Object.entries(contract.storage.namespaces)) {
    for (const [name, table] of Object.entries(namespace.entries.table ?? {})) {
      for (const foreignKey of table.foreignKeys) {
        const key = tableKey({
          namespaceId: foreignKey.target.namespaceId,
          name: foreignKey.target.tableName,
        });
        referencing.set(key, [
          ...(referencing.get(key) ?? []),
          {
            table: { namespaceId, name },
            onDelete: foreignKey.onDelete,
            onUpdate: foreignKey.onUpdate,
          },
        ]);
      }
    }
  }
  referencingByContract.set(contract, referencing);
  return referencing;
}

export function changedBy(
  contract: Contract<SqlStorage>,
  write: WriteKind,
  table: TableCoordinate,
): readonly TableCoordinate[] {
  if (write === 'insert') {
    return [table];
  }
  const referencing = referencingOf(contract);
  const changed = new Map([[tableKey(table), table]]);
  const pending = [table];
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    for (const reference of referencing.get(tableKey(next)) ?? []) {
      const action = write === 'delete' ? reference.onDelete : reference.onUpdate;
      const key = tableKey(reference.table);
      if (changingActions.has(action) && !changed.has(key)) {
        changed.set(key, reference.table);
        pending.push(reference.table);
      }
    }
  }
  return [...changed.values()];
}
