import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { recordedAccessChangesOf } from '../../src/core/migrations/access-changes';
import {
  CreatePostgresRlsPolicyCall,
  DisableRowLevelSecurityCall,
  DropPostgresRlsPolicyCall,
  EnableRowLevelSecurityCall,
  RenamePostgresRlsPolicyCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createRlsPolicy,
  disableRowLevelSecurity,
  dropRlsPolicy,
  enableRowLevelSecurity,
  renameRlsPolicy,
} from '../../src/core/migrations/operations/rls';
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

  it('does not list a dropped policy whose replacement the migration creates first', async () => {
    const operations = recorded([
      await createRlsPolicy('public', 'profiles', policy('read_own', 'ef56ab78'), lowerer),
      await dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([]);
  });

  it('lists a dropped policy when the migration drops its replacement too', async () => {
    const operations = recorded([
      await dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer),
      await createRlsPolicy('public', 'profiles', policy('read_own', 'ef56ab78'), lowerer),
      await dropRlsPolicy('public', 'profiles', 'read_own_ef56ab78', lowerer),
    ]);

    expect(recordedAccessChangesOf(operations)).toEqual([
      { operationIndex: 0, subject: PROFILES, widens: false },
    ]);
  });

  it('does not list a policy the migration both creates and drops', async () => {
    const operations = recorded([
      await createRlsPolicy('public', 'profiles', policy('read_own', 'ef56ab78'), lowerer),
      await dropRlsPolicy('public', 'profiles', 'read_own_ef56ab78', lowerer),
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

  it('recognises operations as an ops.json written by an earlier release records them', () => {
    const recordedOps = JSON.parse(`[
      {
        "id": "rowLevelSecurity.public.profiles.disable",
        "label": "Disable row-level security on \\"profiles\\"",
        "operationClass": "widening",
        "target": { "id": "postgres", "details": { "schema": "public", "objectType": "rowLevelSecurity", "name": "profiles" } },
        "precheck": [], "execute": [], "postcheck": []
      },
      {
        "id": "rlsPolicy.public.profiles.read_own_ab12cd34.drop",
        "label": "Drop RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\"",
        "operationClass": "widening",
        "target": { "id": "postgres", "details": { "schema": "public", "objectType": "rlsPolicy", "name": "read_own_ab12cd34", "table": "profiles" } },
        "precheck": [], "execute": [], "postcheck": []
      },
      {
        "id": "rlsPolicy.public.posts.owner_ab12cd34.drop",
        "label": "Drop RLS policy \\"owner_ab12cd34\\" on \\"posts\\"",
        "operationClass": "widening",
        "target": { "id": "postgres", "details": { "schema": "public", "objectType": "rlsPolicy", "name": "owner_ab12cd34", "table": "posts" } },
        "precheck": [], "execute": [], "postcheck": []
      },
      {
        "id": "rlsPolicy.public.posts.owner_ef56ab78",
        "label": "Create RLS policy \\"owner_ef56ab78\\" on \\"posts\\"",
        "operationClass": "additive",
        "target": { "id": "postgres", "details": { "schema": "public", "objectType": "rlsPolicy", "name": "owner_ef56ab78", "table": "posts" } },
        "precheck": [], "execute": [], "postcheck": []
      }
    ]`);

    expect(recordedAccessChangesOf(recordedOps)).toEqual([
      { operationIndex: 0, subject: PROFILES, widens: true },
      { operationIndex: 1, subject: PROFILES, widens: false },
    ]);
  });
});

describe('rlsIdentity', () => {
  it.each([
    [
      'CreatePostgresRlsPolicyCall',
      new CreatePostgresRlsPolicyCall('public', 'profiles', policy('read_own', 'ab12cd34')),
    ],
    [
      'DropPostgresRlsPolicyCall',
      new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_ab12cd34'),
    ],
    ['EnableRowLevelSecurityCall', new EnableRowLevelSecurityCall('public', 'profiles')],
    ['DisableRowLevelSecurityCall', new DisableRowLevelSecurityCall('public', 'profiles')],
    [
      'RenamePostgresRlsPolicyCall',
      new RenamePostgresRlsPolicyCall('public', 'profiles', 'read_own_ab12cd34', 'owner_ab12cd34'),
    ],
  ] as const)('of %s is the id and target of the operation it lowers to', async (_name, call) => {
    const { id, target } = await call.toOp(lowerer);

    expect(call.rlsIdentity()).toEqual({ id, target });
  });
});
