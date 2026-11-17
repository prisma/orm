import { asNamespaceId } from '@internal/contract/types';
import type { CallSubjects, SubjectStorage } from '../src/core/migrations/operation-subjects';
import type { TableRenameByHand } from '../src/core/migrations/statement-planning';
import { contractOf } from './statement-fixtures';

export const app = asNamespaceId('app');

export const byHand: TableRenameByHand = {
  renderTableRename: ({ from, to }) => `this.renameTable("${from}", "${to}")`,
  tableRenameByHand: ({ from, to }) => [`ALTER TABLE "${from}" RENAME TO "${to}"`],
};

export function table(name: string, storageName = name): SubjectStorage {
  return { storageName, table: { namespaceId: 'app', table: name, column: undefined } };
}

export function column(tableName: string, columnName: string): SubjectStorage {
  return {
    storageName: `${tableName}.${columnName}`,
    table: { namespaceId: 'app', table: tableName, column: columnName },
  };
}

export function losing(...targets: readonly SubjectStorage[]): CallSubjects {
  return {
    operationCount: 1,
    label: 'Drop',
    dataLoss: targets.map((target) => ({ ...target, loss: 'drop' })),
    accessChanges: [],
    temporaryValues: [],
  };
}

export const unchanged: CallSubjects = {
  operationCount: 1,
  label: 'Unchanged',
  dataLoss: [],
  accessChanges: [],
  temporaryValues: [],
};

export const origin = contractOf({
  Legacy: { table: 'legacy', fields: { id: 'id' } },
  User: { table: 'user', fields: { id: 'id', name: 'full_name' } },
});
