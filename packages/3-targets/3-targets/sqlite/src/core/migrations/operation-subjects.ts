import {
  type CallSubjects,
  type FieldEventCall,
  fieldEventStorage,
  type SubjectStorage,
  storageNameOfOperation,
  unknownCallNames,
} from '@internal/family-sql/control';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { DropColumnCall, DropTableCall, RawSqlCall, RecreateTableCall } from './op-factory-call';

function tableTarget(table: string): SubjectStorage {
  return {
    storageName: table,
    table: { namespaceId: UNBOUND_NAMESPACE_ID, table, column: undefined },
  };
}

function columnTarget(table: string, column: string): SubjectStorage {
  return {
    storageName: `${table}.${column}`,
    table: { namespaceId: UNBOUND_NAMESPACE_ID, table, column },
  };
}

function operationCountOf(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/**
 * The columns a recreate loses: those the new table leaves out, whose values the copy drops, and,
 * when the recreate is destructive, those whose type it changes.
 */
function recreateLosses(call: RecreateTableCall): readonly string[] {
  const kept = new Set(call.contractTable.columns.map((column) => column.name));
  const dropped = call.schemaColumnNames.filter((column) => !kept.has(column));
  return [...dropped, ...(call.operationClass === 'destructive' ? call.lossyColumns : [])];
}

/**
 * What each call of a SQLite plan loses. A recreate that leaves a column out loses its values
 * itself, so a later drop of that column is not listed again.
 */
export function sqliteCallSubjects(
  calls: readonly OpFactoryCall[],
  fieldEvents: ReadonlyMap<OpFactoryCall, FieldEventCall>,
): readonly CallSubjects[] {
  const lost = new Set<string>();
  const unknownNames = unknownCallNames(
    calls.filter(
      (call) =>
        call.operationClass === 'destructive' &&
        !(call instanceof RecreateTableCall) &&
        !(call instanceof DropColumnCall) &&
        !(call instanceof DropTableCall) &&
        !(call instanceof RawSqlCall) &&
        !fieldEvents.has(call),
    ),
  );
  return calls.map((call): CallSubjects => {
    const operationCount = operationCountOf(call);
    if (call instanceof RecreateTableCall) {
      const columns = recreateLosses(call);
      for (const column of columns) lost.add(`${call.tableName}.${column}`);
      const dataLoss =
        columns.length === 0 && call.operationClass === 'destructive'
          ? [tableTarget(call.tableName)]
          : columns.map((column) => columnTarget(call.tableName, column));
      return { operationCount, dataLoss, accessWidening: [] };
    }
    if (call instanceof DropColumnCall) {
      const alreadyLost = lost.has(`${call.tableName}.${call.columnName}`);
      return {
        operationCount,
        dataLoss: alreadyLost ? [] : [columnTarget(call.tableName, call.columnName)],
        accessWidening: [],
      };
    }
    if (call instanceof DropTableCall) {
      return { operationCount, dataLoss: [tableTarget(call.tableName)], accessWidening: [] };
    }
    if (call.operationClass !== 'destructive') {
      return { operationCount, dataLoss: [], accessWidening: [] };
    }
    const fieldEvent = fieldEvents.get(call);
    const lossTarget: SubjectStorage =
      call instanceof RawSqlCall
        ? { storageName: storageNameOfOperation(call.op), table: undefined }
        : fieldEvent !== undefined
          ? fieldEventStorage(fieldEvent)
          : { storageName: unknownNames.get(call) ?? call.factoryName, table: undefined };
    return { operationCount, dataLoss: [lossTarget], accessWidening: [] };
  });
}
