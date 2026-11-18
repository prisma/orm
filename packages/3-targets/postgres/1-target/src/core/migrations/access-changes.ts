import type {
  MigrationAccessChange,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { parseWireName } from '@internal/sql-schema-ir/naming';
import { type } from 'arktype';
import {
  createRlsPolicyIdentity,
  disableRowLevelSecurityIdentity,
  dropRlsPolicyIdentity,
  type RlsOperationIdentity,
} from './operations/rls';

/** An entry of the given list, by its position, that changes who can read or write the rows of `schema.table`. */
export interface TableAccessChange {
  readonly index: number;
  readonly schema: string;
  readonly table: string;
  readonly widens: boolean;
}

const RowLevelSecurityTarget = type({
  details: { schema: 'string', objectType: "'rowLevelSecurity'", name: 'string' },
});

const RlsPolicyTarget = type({
  details: { schema: 'string', objectType: "'rlsPolicy'", name: 'string', table: 'string' },
});

/** An operation's id and target, read before the target is checked: an `RlsOperationIdentity` once it is. */
type UncheckedIdentity = Pick<RlsOperationIdentity, 'id'> & { readonly target: unknown };

interface Table {
  readonly schema: string;
  readonly table: string;
}

interface Policy extends Table {
  readonly name: string;
}

/** The table whose row-level security `identity` disables, when it is the operation `disableRowLevelSecurity` builds. */
function disabledTable(identity: UncheckedIdentity): Table | undefined {
  const target = RowLevelSecurityTarget(identity.target);
  if (target instanceof type.errors) return undefined;
  const { schema, name } = target.details;
  return identity.id === disableRowLevelSecurityIdentity(schema, name).id
    ? { schema, table: name }
    : undefined;
}

function policyOf(
  identity: UncheckedIdentity,
  identityOf: (schema: string, table: string, name: string) => { readonly id: string },
): Policy | undefined {
  const target = RlsPolicyTarget(identity.target);
  if (target instanceof type.errors) return undefined;
  const { schema, table, name } = target.details;
  return identity.id === identityOf(schema, table, name).id ? { schema, table, name } : undefined;
}

/**
 * A policy's identity across a replacement: its name, or the prefix of a generated (wire) name,
 * whose hash changes with the policy's body.
 */
function policyKey({ schema, table, name }: Policy): string {
  return JSON.stringify([schema, table, parseWireName(name)?.prefix ?? name]);
}

/**
 * The operations of one migration that change who can read or write rows. Disabling row-level
 * security widens access: every role with table privileges then reads and writes every row.
 * Dropping a policy changes access either way, since a permissive policy grants access and a
 * restrictive one limits it, unless the same migration creates the policy again, by name or by
 * generated-name prefix. Each operation is recognised from its target and the id its operation
 * factory builds; an operation with neither, such as raw SQL, is not read.
 */
export function accessChangesOfIdentities(
  identities: readonly (UncheckedIdentity | undefined)[],
): readonly TableAccessChange[] {
  const created = new Set(
    identities.flatMap((identity) => {
      const policy =
        identity === undefined ? undefined : policyOf(identity, createRlsPolicyIdentity);
      return policy === undefined ? [] : [policyKey(policy)];
    }),
  );
  return identities.flatMap((identity, index): TableAccessChange[] => {
    if (identity === undefined) return [];
    const disabled = disabledTable(identity);
    if (disabled !== undefined) {
      return [{ index, schema: disabled.schema, table: disabled.table, widens: true }];
    }
    const dropped = policyOf(identity, dropRlsPolicyIdentity);
    if (dropped !== undefined && !created.has(policyKey(dropped))) {
      return [{ index, schema: dropped.schema, table: dropped.table, widens: false }];
    }
    return [];
  });
}

/** The operations of a recorded Postgres migration that change who can read or write rows. */
export function recordedAccessChangesOf(
  operations: readonly MigrationPlanOperation[],
): readonly MigrationAccessChange[] {
  return accessChangesOfIdentities(
    operations.map((operation) => ({ id: operation.id, target: Reflect.get(operation, 'target') })),
  ).map(({ index, schema, table, widens }) => ({
    operationIndex: index,
    subject: {
      kind: 'storage',
      name: schema === UNBOUND_NAMESPACE_ID ? table : `${schema}.${table}`,
    },
    widens,
  }));
}
