import type {
  MigrationAccessChange,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type } from 'arktype';
import { policyKey } from './operation-subjects';
import {
  disableRowLevelSecurityOperationId,
  dropRlsPolicyOperationId,
  rlsPolicyOperationId,
} from './operations/rls';

const RowLevelSecurityTarget = type({
  details: { schema: 'string', objectType: "'rowLevelSecurity'", name: 'string' },
});

const RlsPolicyTarget = type({
  details: { schema: 'string', objectType: "'rlsPolicy'", name: 'string', table: 'string' },
});

interface RecordedPolicy {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
}

function targetOf(operation: MigrationPlanOperation): unknown {
  return Reflect.get(operation, 'target');
}

/** The table whose row-level security `operation` disables, when it is the operation `disableRowLevelSecurity` builds. */
function disabledTable(
  operation: MigrationPlanOperation,
): { readonly schema: string; readonly table: string } | undefined {
  const target = RowLevelSecurityTarget(targetOf(operation));
  if (target instanceof type.errors) return undefined;
  const { schema, name } = target.details;
  return operation.id === disableRowLevelSecurityOperationId(schema, name)
    ? { schema, table: name }
    : undefined;
}

function policyOf(
  operation: MigrationPlanOperation,
  operationId: (schema: string, table: string, name: string) => string,
): RecordedPolicy | undefined {
  const target = RlsPolicyTarget(targetOf(operation));
  if (target instanceof type.errors) return undefined;
  const { schema, table, name } = target.details;
  return operation.id === operationId(schema, table, name) ? { schema, table, name } : undefined;
}

function tableSubject(schema: string, table: string): MigrationAccessChange['subject'] {
  return {
    kind: 'storage',
    name: schema === UNBOUND_NAMESPACE_ID ? table : `${schema}.${table}`,
  };
}

/**
 * The operations of a recorded Postgres migration that change who can read or write rows: disabling
 * row-level security, which widens access, and dropping a policy the migration does not create
 * again, which changes it either way. Each is recognised from its target details and the id its
 * operation factory builds; raw SQL is not read.
 */
export function recordedAccessChangesOf(
  operations: readonly MigrationPlanOperation[],
): readonly MigrationAccessChange[] {
  const created = new Set(
    operations.flatMap((operation) => {
      const policy = policyOf(operation, rlsPolicyOperationId);
      return policy === undefined ? [] : [policyKey(policy.schema, policy.table, policy.name)];
    }),
  );
  return operations.flatMap((operation, operationIndex): MigrationAccessChange[] => {
    const disabled = disabledTable(operation);
    if (disabled !== undefined) {
      return [
        { operationIndex, subject: tableSubject(disabled.schema, disabled.table), widens: true },
      ];
    }
    const dropped = policyOf(operation, dropRlsPolicyOperationId);
    if (
      dropped !== undefined &&
      !created.has(policyKey(dropped.schema, dropped.table, dropped.name))
    ) {
      return [
        { operationIndex, subject: tableSubject(dropped.schema, dropped.table), widens: false },
      ];
    }
    return [];
  });
}
