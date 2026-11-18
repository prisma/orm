import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  createRlsPolicy,
  disableRowLevelSecurity,
  dropRlsPolicy,
  enableRowLevelSecurity,
  renameRlsPolicy,
} from '../../src/core/migrations/operations/rls';
import { recordedAccessChangesOf } from '../../src/core/migrations/recorded-access-changes';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';

const lowerer: ExecuteRequestLowerer = {
  lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => Object.freeze({ sql: 'SELECT 1', params: Object.freeze([]) }),
};

function policy(prefix: string, hash: string, tableName = 'profiles'): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: parseNaming(`${prefix}_${hash}`, prefix),
    tableName,
    namespaceId: 'public',
    operation: 'select',
    roles: [],
    using: '(true)',
    permissive: true,
    withCheck: undefined,
  });
}

/** The operations as `ops.json` records them. */
function recorded(operations: readonly MigrationPlanOperation[]): MigrationPlanOperation[] {
  return JSON.parse(JSON.stringify(operations));
}

const PROFILES = { kind: 'storage', name: 'public.profiles' } as const;

describe('recordedAccessChangesOf', () => {
  it('lists disabling row-level security as a change that widens access', async () => {
    const operations = recorded([await disableRowLevelSecurity('public', 'profiles', lowerer)]);

    expect(recordedAccessChangesOf(operations)).toEqual([
      { operationIndex: 0, subject: PROFILES, widens: true },
    ]);
  });

  it('lists dropping a policy as a change that may go either way', async () => {
    const operations = recorded([
      await enableRowLevelSecurity('public', 'profiles', lowerer),
      await dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([
      { operationIndex: 1, subject: PROFILES, widens: false },
    ]);
  });

  it('does not list a dropped policy the same migration creates again under its prefix', async () => {
    const operations = recorded([
      await dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer),
      await createRlsPolicy('public', 'profiles', policy('read_own', 'ef56ab78'), lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([]);
  });

  it('lists a dropped policy when the migration creates one on another table', async () => {
    const operations = recorded([
      await dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer),
      await createRlsPolicy('public', 'posts', policy('read_own', 'ef56ab78', 'posts'), lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([
      { operationIndex: 0, subject: PROFILES, widens: false },
    ]);
  });

  it('does not list renaming, creating a policy, or enabling row-level security', async () => {
    const operations = recorded([
      await renameRlsPolicy('public', 'profiles', 'read_own_ab12cd34', 'owner_ab12cd34', lowerer),
      await createRlsPolicy('public', 'profiles', policy('owner', 'ab12cd34'), lowerer),
      await enableRowLevelSecurity('public', 'profiles', lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([]);
  });

  it('does not read the label', () => {
    const operations: MigrationPlanOperation[] = [
      {
        id: 'raw.disable',
        label: 'Disable row-level security on "profiles"',
        operationClass: 'widening',
      },
      { id: 'table.profiles', label: 'Create table profiles', operationClass: 'additive' },
    ];

    expect(recordedAccessChangesOf(operations)).toEqual([]);
  });
});
