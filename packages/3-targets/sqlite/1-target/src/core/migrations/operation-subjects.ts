import {
  type CallSubjects,
  type FieldEventCall,
  fieldEventStorage,
  type StoredValueSubject,
  type SubjectStorage,
  storageNameOfOperation,
  unknownCallNames,
} from '@internal/family-sql/control';
import type { MigrationDataLossKind, OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { ifDefined } from '@internal/utils/defined';
import {
  DeleteRowsCall,
  DropColumnCall,
  DropTableCall,
  RawSqlCall,
  RecreateTableCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
} from './op-factory-call';

type LostStorage = CallSubjects['dataLoss'][number];

function lost(target: SubjectStorage, loss: MigrationDataLossKind = 'drop'): LostStorage {
  return { ...target, loss };
}

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
 * when the recreate is destructive, those whose type it changes with no copy expression to convert them.
 */
function recreateLosses(
  call: RecreateTableCall,
): readonly { readonly column: string; readonly loss: MigrationDataLossKind }[] {
  const kept = new Set(call.contractTable.columns.map((column) => column.name));
  const dropped = call.schemaColumnNames.filter((column) => !kept.has(column));
  const retyped =
    call.operationClass === 'destructive'
      ? call.retypedColumns.filter((column) => !Object.hasOwn(call.copyExpressions, column))
      : [];
  return [
    ...dropped.map((column) => ({ column, loss: 'drop' as const })),
    ...retyped.map((column) => ({ column, loss: 'typeChange' as const })),
  ];
}

/** The columns a recreate adds with a value its copy writes into every existing row. */
function temporaryValuesOf(call: RecreateTableCall): CallSubjects['temporaryValues'] {
  const copied = new Set(call.schemaColumnNames);
  return Object.entries(call.temporaryValues).flatMap(([column, expression]) =>
    copied.has(column) || expression.kind !== 'sql'
      ? []
      : [{ table: call.tableName, column, value: expression.sql }],
  );
}

/**
 * What each call of a SQLite plan loses. A recreate that leaves a column out loses its values
 * itself, so a later drop of that column is not listed again.
 */
export function sqliteCallSubjects(
  calls: readonly OpFactoryCall[],
  fieldEvents: ReadonlyMap<OpFactoryCall, FieldEventCall>,
  storedValues: ReadonlyMap<OpFactoryCall, StoredValueSubject> = new Map(),
): readonly CallSubjects[] {
  const lostColumns = new Set<string>();
  const unknownNames = unknownCallNames(
    calls.filter(
      (call) =>
        call.operationClass === 'destructive' &&
        !(call instanceof RecreateTableCall) &&
        !(call instanceof DropColumnCall) &&
        !(call instanceof DropTableCall) &&
        !(call instanceof RawSqlCall) &&
        !(call instanceof RemoveStoredValueCall) &&
        !(call instanceof RemoveStoredKeyCall) &&
        !(call instanceof DeleteRowsCall) &&
        !fieldEvents.has(call),
    ),
  );
  return calls.map((call): CallSubjects => {
    const operationCount = operationCountOf(call);
    const { label } = call;
    if (call instanceof RecreateTableCall) {
      const columns = recreateLosses(call);
      for (const { column } of columns) lostColumns.add(`${call.tableName}.${column}`);
      const dataLoss =
        columns.length === 0 && call.operationClass === 'destructive'
          ? [lost(tableTarget(call.tableName))]
          : columns.map(({ column, loss }) => lost(columnTarget(call.tableName, column), loss));
      return {
        operationCount,
        label,
        dataLoss,
        accessChanges: [],
        temporaryValues: temporaryValuesOf(call),
      };
    }
    if (call instanceof DropColumnCall) {
      const alreadyLost = lostColumns.has(`${call.tableName}.${call.columnName}`);
      return {
        operationCount,
        label,
        dataLoss: alreadyLost ? [] : [lost(columnTarget(call.tableName, call.columnName))],
        accessChanges: [],
        temporaryValues: [],
      };
    }
    if (call instanceof DeleteRowsCall) {
      return {
        operationCount,
        label,
        dataLoss: [lost(tableTarget(call.tableName))],
        accessChanges: [],
        temporaryValues: [],
      };
    }
    if (call instanceof RemoveStoredKeyCall) {
      return {
        operationCount,
        label,
        dataLoss: [lost(columnTarget(call.tableName, call.columnName))],
        accessChanges: [],
        temporaryValues: [],
      };
    }
    if (call instanceof RemoveStoredValueCall) {
      const subject = storedValues.get(call);
      return {
        operationCount,
        label,
        dataLoss: [
          {
            ...lost(columnTarget(call.tableName, call.columnName)),
            ...ifDefined('enumValue', subject?.enumValue),
            ...ifDefined('keepDataEdit', subject?.keepDataEdit),
          },
        ],
        accessChanges: [],
        temporaryValues: [],
      };
    }
    if (call instanceof DropTableCall) {
      return {
        operationCount,
        label,
        dataLoss: [lost(tableTarget(call.tableName))],
        accessChanges: [],
        temporaryValues: [],
      };
    }
    if (call.operationClass !== 'destructive') {
      return { operationCount, label, dataLoss: [], accessChanges: [], temporaryValues: [] };
    }
    const fieldEvent = fieldEvents.get(call);
    const lossTarget: SubjectStorage =
      call instanceof RawSqlCall
        ? { storageName: storageNameOfOperation(call.op), table: undefined }
        : fieldEvent !== undefined
          ? fieldEventStorage(fieldEvent)
          : { storageName: unknownNames.get(call) ?? call.factoryName, table: undefined };
    return {
      operationCount,
      label,
      dataLoss: [lost(lossTarget)],
      accessChanges: [],
      temporaryValues: [],
    };
  });
}
