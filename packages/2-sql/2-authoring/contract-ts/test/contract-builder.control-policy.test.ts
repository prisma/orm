import type { Contract, ControlPolicy } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { unboundTables } from './unbound-tables';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4Column = columnDescriptor('pg/int4@1');

function tableEffectiveControl(
  tableControl: ControlPolicy | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  return effectiveControlPolicy(tableControl, defaultControlPolicy);
}

describe('defineContract defaultControlPolicy', () => {
  it('lowers defaultControlPolicy to Contract.defaultControlPolicy', () => {
    const built = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      defaultControlPolicy: 'external',
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
      },
    });

    expect(built.defaultControlPolicy).toBe('external');
  });

  it('omits defaultControlPolicy when unset', () => {
    const built = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
      },
    });

    expect(built).not.toHaveProperty('defaultControlPolicy');
  });
});

describe('defineContract per-table control', () => {
  const policies = [
    'managed',
    'tolerated',
    'external',
    'observed',
  ] as const satisfies readonly ControlPolicy[];

  it('accepts each ControlPolicy on the table sql stage', () => {
    for (const control of policies) {
      const built = defineContract({
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        models: {
          User: model('User', {
            fields: { id: field.column(int4Column).id() },
          }).sql({ table: 'app_user', control }),
        },
      });

      const table = unboundTables(built.storage)['app_user'];
      expect(tableEffectiveControl(table?.control, built.defaultControlPolicy)).toBe(control);
      if (control === 'managed') {
        expect(table?.control).toBe('managed');
      }
    }
  });

  it('omits per-node control and defaultControlPolicy when neither is authored', () => {
    const built = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
      },
    });

    expect(built).not.toHaveProperty('defaultControlPolicy');
    const table = unboundTables(built.storage)['app_user'];
    expect(table).not.toHaveProperty('control');
  });
});

describe('defineContract mixed default and per-table control', () => {
  it('resolves effective control per table and round-trips through the canonical deserializer', () => {
    const built = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      defaultControlPolicy: 'external',
      models: {
        User: model('User', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'app_user' }),
        Profile: model('Profile', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'user_profile', control: 'managed' }),
        Audit: model('Audit', {
          fields: { id: field.column(int4Column).id() },
        }).sql({ table: 'audit_log', control: 'tolerated' }),
      },
    });

    const tables = unboundTables(built.storage);
    expect(tableEffectiveControl(tables['app_user']?.control, built.defaultControlPolicy)).toBe(
      'external',
    );
    expect(tableEffectiveControl(tables['user_profile']?.control, built.defaultControlPolicy)).toBe(
      'managed',
    );
    expect(tableEffectiveControl(tables['audit_log']?.control, built.defaultControlPolicy)).toBe(
      'tolerated',
    );

    const envelope = JSON.parse(JSON.stringify(built)) as unknown;
    const roundTripped = validateSqlContractFully<Contract<SqlStorage>>(envelope);
    const roundTrippedTables = unboundTables(roundTripped.storage);
    const def = roundTripped.defaultControlPolicy;

    expect(def).toBe('external');
    expect(tableEffectiveControl(roundTrippedTables['app_user']?.control, def)).toBe('external');
    expect(tableEffectiveControl(roundTrippedTables['user_profile']?.control, def)).toBe('managed');
    expect(tableEffectiveControl(roundTrippedTables['audit_log']?.control, def)).toBe('tolerated');

    // Omit-when-default holds across the canonical round-trip: the table that
    // inherits the default never grows a per-node control property.
    expect(roundTrippedTables['app_user']).not.toHaveProperty('control');
  });
});
