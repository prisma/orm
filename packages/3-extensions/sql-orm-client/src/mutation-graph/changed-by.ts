import type { Contract } from '@internal/contract/types';
import type { ReferentialAction, SqlStorage } from '@internal/sql-contract/types';
import type { TableCoordinate } from '@internal/sql-relational-core/ast';

export type WriteKind = 'insert' | 'update' | 'delete';

interface Referencing {
  readonly table: TableCoordinate;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
}

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

type ChangeKind = Exclude<WriteKind, 'insert'>;

interface Step {
  readonly table: TableCoordinate;
  readonly kind: ChangeKind;
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
  const visited = new Set([stepKey({ table, kind: write })]);
  const pending: Step[] = [{ table, kind: write }];
  for (let step = pending.shift(); step !== undefined; step = pending.shift()) {
    for (const reference of referencing.get(tableKey(step.table)) ?? []) {
      const next = nextStep(step.kind, reference);
      if (next !== undefined && !visited.has(stepKey(next))) {
        visited.add(stepKey(next));
        changed.set(tableKey(next.table), next.table);
        pending.push(next);
      }
    }
  }
  return [...changed.values()];
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
  return JSON.stringify([step.kind, step.table.namespaceId, step.table.name]);
}
