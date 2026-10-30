import type { Contract } from '@internal/contract/types';
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
import type { SqlStorage } from '@internal/sql-contract/types';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { ifDefined } from '@internal/utils/defined';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import {
  AddColumnWithTemporaryDefaultCall,
  AlterColumnTypeCall,
  CreatePostgresRlsPolicyCall,
  DeleteRowsCall,
  DisableRowLevelSecurityCall,
  DropColumnCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  RawSqlCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
} from './op-factory-call';

interface Locator {
  /** The contract that names the namespaces: the origin contract when the plan has one. */
  readonly contract: Contract<SqlStorage>;
  /** The codec hooks' calls, each with the column of the field event it was returned for. */
  readonly fieldEvents: ReadonlyMap<OpFactoryCall, FieldEventCall>;
  /** The stored value removals the planner made for enum values, each with its enum value. */
  readonly storedValues?: ReadonlyMap<OpFactoryCall, StoredValueSubject>;
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
  if (call instanceof DropTableCall || call instanceof DeleteRowsCall) {
    return target(locator, call.schemaName, call.tableName, undefined);
  }
  if (
    call instanceof DropColumnCall ||
    call instanceof AlterColumnTypeCall ||
    call instanceof RemoveStoredKeyCall
  ) {
    return target(locator, call.schemaName, call.tableName, call.columnName);
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

/**
 * A policy's identity across a replacement: its name, or the prefix of a generated (wire) name,
 * whose hash changes with the policy's body.
 */
function policyKey(schemaName: string, tableName: string, policyName: string): string {
  return JSON.stringify([schemaName, tableName, parseWireName(policyName)?.prefix ?? policyName]);
}

/**
 * The policies the plan creates. A drop of one of them, by name or by generated-name prefix, is
 * half of a replacement, which leaves a policy in place, so it widens no access.
 */
function createdPolicies(calls: readonly OpFactoryCall[]): ReadonlySet<string> {
  return new Set(
    calls.flatMap((call) =>
      call instanceof CreatePostgresRlsPolicyCall
        ? [policyKey(call.schemaName, call.tableName, call.policy.name)]
        : [],
    ),
  );
}

/**
 * Disabling row-level security widens access: every role with table privileges then reads and
 * writes every row. Dropping a policy changes access either way, since a permissive policy grants
 * access and a restrictive one limits it, unless the plan creates the policy again.
 */
function accessChangesOf(
  locator: Locator,
  call: OpFactoryCall,
  replaced: ReadonlySet<string>,
): CallSubjects['accessChanges'] {
  if (call instanceof DisableRowLevelSecurityCall) {
    return [{ ...target(locator, call.schemaName, call.tableName, undefined), widens: true }];
  }
  if (
    call instanceof DropPostgresRlsPolicyCall &&
    !replaced.has(policyKey(call.schemaName, call.tableName, call.policyName))
  ) {
    return [{ ...target(locator, call.schemaName, call.tableName, undefined), widens: false }];
  }
  return [];
}

function operationCountOf(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/** What each call of a Postgres plan loses, and whose access it changes. */
export function postgresCallSubjects(
  calls: readonly OpFactoryCall[],
  locator: Locator,
): readonly CallSubjects[] {
  const replaced = createdPolicies(calls);
  const destructive = calls.filter((call) => call.operationClass === 'destructive');
  const known = new Map(destructive.map((call) => [call, knownTarget(locator, call)]));
  const unknownNames = unknownCallNames(
    destructive.filter((call) => known.get(call) === undefined),
  );
  return calls.map((call) => {
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
      accessChanges: accessChangesOf(locator, call, replaced),
      temporaryValues:
        call instanceof AddColumnWithTemporaryDefaultCall
          ? [{ table: call.tableName, column: call.columnName, value: call.temporaryDefault }]
          : [],
    };
  });
}
