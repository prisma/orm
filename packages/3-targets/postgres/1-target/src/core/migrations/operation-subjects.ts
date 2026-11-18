import type { Contract } from '@internal/contract/types';
import {
  type CallSubjects,
  type FieldEventCall,
  fieldEventStorage,
  type StoredValueSubject,
  type SubjectStorage,
  storageNameOfOperation,
  UnfilledValue,
  unknownCallNames,
} from '@internal/family-sql/control';
import type {
  MigrationDataLossKind,
  ModelCoordinate,
  OpFactoryCall,
  ValueObjectFieldCoordinate,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import {
  AddColumnWithTemporaryDefaultCall,
  AlterColumnTypeCall,
  DeleteRowsCall,
  DropColumnCall,
  DropTableCall,
  FillStoredKeyCall,
  isPostgresOpFactoryCall,
  RawSqlCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
} from './op-factory-call';
import { accessChangesOfIdentities } from './recorded-access-changes';

interface Locator {
  /** The contract that names the namespaces: the origin contract when the plan has one. */
  readonly contract: Contract<SqlStorage>;
  /** The codec hooks' calls, each with the column of the field event it was returned for. */
  readonly fieldEvents: ReadonlyMap<OpFactoryCall, FieldEventCall>;
  /** The stored value removals the planner made for enum values, each with its enum value. */
  readonly storedValues?: ReadonlyMap<OpFactoryCall, StoredValueSubject>;
  /** The key removals and fills the planner made for value object fields, each with its value object field. */
  readonly storedKeys?: ReadonlyMap<OpFactoryCall, ValueObjectFieldCoordinate>;
  /** The row deletions the planner made for variants, each with its variant as the origin names it. */
  readonly variantRows?: ReadonlyMap<OpFactoryCall, ModelCoordinate>;
}

/**
 * The namespace a schema stands for in the locator's contract, or, for a schema that contract does
 * not declare, such as the new name of a renamed namespace, the schema's own name: a named Postgres
 * namespace's schema is its id.
 */
function storageNamespaceId(locator: Locator, schemaName: string): string {
  if (schemaName === UNBOUND_NAMESPACE_ID) return UNBOUND_NAMESPACE_ID;
  const namespaceId = resolveNamespaceIdForDdlSchema(locator.contract, schemaName);
  return namespaceId === UNBOUND_NAMESPACE_ID && schemaName !== DEFAULT_NAMESPACE_ID
    ? schemaName
    : namespaceId;
}

function qualified(schemaName: string, name: string): string {
  return schemaName === UNBOUND_NAMESPACE_ID ? name : `${schemaName}.${name}`;
}

function target(
  locator: Locator,
  schemaName: string,
  table: string,
  column: string | undefined,
): SubjectStorage {
  return {
    storageName: qualified(schemaName, column === undefined ? table : `${table}.${column}`),
    table: { namespaceId: storageNamespaceId(locator, schemaName), table, column },
  };
}

function rawSqlTarget(locator: Locator, call: RawSqlCall): SubjectStorage {
  const details = call.op.target.details;
  if (details === undefined) return { storageName: call.op.id, table: undefined };
  if (details.objectType === 'table')
    return target(locator, details.schema, details.name, undefined);
  if (details.objectType === 'column' && details.table !== undefined) {
    return target(locator, details.schema, details.table, details.name);
  }
  return { storageName: storageNameOfOperation(call.op), table: undefined };
}

function knownTarget(locator: Locator, call: OpFactoryCall): SubjectStorage | undefined {
  if (call instanceof DropTableCall) {
    return target(locator, call.schemaName, call.tableName, undefined);
  }
  if (call instanceof DeleteRowsCall) {
    return {
      ...target(locator, call.schemaName, call.tableName, undefined),
      ...ifDefined('model', locator.variantRows?.get(call)),
    };
  }
  if (call instanceof DropColumnCall || call instanceof AlterColumnTypeCall) {
    return target(locator, call.schemaName, call.tableName, call.columnName);
  }
  if (call instanceof RemoveStoredKeyCall) {
    return {
      ...target(locator, call.schemaName, call.tableName, call.columnName),
      ...ifDefined('valueObjectField', locator.storedKeys?.get(call)),
    };
  }
  if (call instanceof RemoveStoredValueCall) {
    const enumValue = locator.storedValues?.get(call)?.enumValue;
    return {
      ...target(locator, call.schemaName, call.tableName, call.columnName),
      ...ifDefined('enumValue', enumValue),
    };
  }
  if (call instanceof RawSqlCall) return rawSqlTarget(locator, call);
  const fieldEvent = locator.fieldEvents.get(call);
  return fieldEvent === undefined ? undefined : fieldEventStorage(fieldEvent);
}

/** The temporary values a call writes: a new required column's, or a planner-written fill's of a value object field. */
function temporaryValuesOf(locator: Locator, call: OpFactoryCall): CallSubjects['temporaryValues'] {
  if (call instanceof AddColumnWithTemporaryDefaultCall) {
    return [{ table: call.tableName, column: call.columnName, value: call.temporaryDefault }];
  }
  const valueObjectField = locator.storedKeys?.get(call);
  if (
    !(call instanceof FillStoredKeyCall) ||
    call.value instanceof UnfilledValue ||
    valueObjectField === undefined
  ) {
    return [];
  }
  return [
    {
      table: call.tableName,
      column: call.columnName,
      value: JSON.stringify(call.value),
      valueObjectField,
    },
  ];
}

function operationCountOf(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/** What each call of a Postgres plan loses, and whose access it changes. */
export function postgresCallSubjects(
  calls: readonly OpFactoryCall[],
  locator: Locator,
): readonly CallSubjects[] {
  const accessChanges = new Map(
    accessChangesOfIdentities(
      calls.map((call) => (isPostgresOpFactoryCall(call) ? call.rlsIdentity() : undefined)),
    ).map((change) => [change.operationIndex, change]),
  );
  const destructive = calls.filter((call) => call.operationClass === 'destructive');
  const known = new Map(destructive.map((call) => [call, knownTarget(locator, call)]));
  const unknownNames = unknownCallNames(
    destructive.filter((call) => known.get(call) === undefined),
  );
  return calls.map((call, callIndex) => {
    const accessChange = accessChanges.get(callIndex);
    const lossTarget = known.get(call);
    const unknownName = unknownNames.get(call);
    const loss: MigrationDataLossKind = call instanceof AlterColumnTypeCall ? 'typeChange' : 'drop';
    return {
      operationCount: operationCountOf(call),
      label: call.label,
      dataLoss:
        lossTarget !== undefined
          ? [
              {
                ...lossTarget,
                loss,
                ...ifDefined('keepDataEdit', locator.storedValues?.get(call)?.keepDataEdit),
              },
            ]
          : unknownName !== undefined
            ? [{ storageName: unknownName, table: undefined, loss }]
            : [],
      accessChanges:
        accessChange === undefined
          ? []
          : [
              {
                ...target(locator, accessChange.schema, accessChange.table, undefined),
                widens: accessChange.widens,
              },
            ],
      temporaryValues: temporaryValuesOf(locator, call),
    };
  });
}
