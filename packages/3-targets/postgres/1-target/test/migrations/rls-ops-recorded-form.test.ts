import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
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

const policy = new PostgresRlsPolicy({
  naming: parseNaming('read_own_ab12cd34', 'read_own'),
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select',
  roles: [],
  using: '(true)',
  permissive: true,
  withCheck: undefined,
});

/** Each operation as `ops.json` records it, key order included. */
const RECORDED = {
  createRlsPolicy:
    '{"id":"rlsPolicy.public.profiles.read_own_ab12cd34","label":"Create RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\"","operationClass":"additive","target":{"id":"postgres","details":{"schema":"public","objectType":"rlsPolicy","name":"read_own_ab12cd34","table":"profiles"}},"precheck":[{"description":"ensure RLS policy \\"read_own_ab12cd34\\" does not exist","sql":"SELECT 1","params":[],"expectation":{"expects":"absent","object":"RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\""}}],"execute":[{"description":"create RLS policy \\"read_own_ab12cd34\\"","sql":"SELECT 1","params":[]}],"postcheck":[{"description":"verify RLS policy \\"read_own_ab12cd34\\" exists with the planned command, roles and permissiveness","sql":"SELECT 1","params":[]}]}',
  dropRlsPolicy:
    '{"id":"rlsPolicy.public.profiles.read_own_ab12cd34.drop","label":"Drop RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\"","operationClass":"widening","target":{"id":"postgres","details":{"schema":"public","objectType":"rlsPolicy","name":"read_own_ab12cd34","table":"profiles"}},"precheck":[{"description":"ensure RLS policy \\"read_own_ab12cd34\\" exists","sql":"SELECT 1","params":[],"expectation":{"expects":"present","object":"RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\""}}],"execute":[{"description":"drop RLS policy \\"read_own_ab12cd34\\"","sql":"SELECT 1","params":[]}],"postcheck":[{"description":"verify RLS policy \\"read_own_ab12cd34\\" is absent","sql":"SELECT 1","params":[],"expectation":{"expects":"absent","object":"RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\""}}]}',
  enableRowLevelSecurity:
    '{"id":"rowLevelSecurity.public.profiles","label":"Enable row-level security on \\"profiles\\"","operationClass":"additive","target":{"id":"postgres","details":{"schema":"public","objectType":"rowLevelSecurity","name":"profiles"}},"precheck":[{"description":"check RLS is not already enabled on \\"profiles\\"","sql":"SELECT 1","params":[]}],"execute":[{"description":"enable row-level security on \\"profiles\\"","sql":"ALTER TABLE \\"public\\".\\"profiles\\" ENABLE ROW LEVEL SECURITY"}],"postcheck":[{"description":"verify row-level security is enabled on \\"profiles\\"","sql":"SELECT 1","params":[]}]}',
  disableRowLevelSecurity:
    '{"id":"rowLevelSecurity.public.profiles.disable","label":"Disable row-level security on \\"profiles\\"","operationClass":"widening","target":{"id":"postgres","details":{"schema":"public","objectType":"rowLevelSecurity","name":"profiles"}},"precheck":[{"description":"check RLS is currently enabled on \\"profiles\\"","sql":"SELECT 1","params":[]}],"execute":[{"description":"disable row-level security on \\"profiles\\"","sql":"SELECT 1","params":[]}],"postcheck":[{"description":"verify row-level security is disabled on \\"profiles\\"","sql":"SELECT 1","params":[]}]}',
  renameRlsPolicy:
    '{"id":"rlsPolicy.public.profiles.read_own_ab12cd34.rename","label":"Rename RLS policy \\"read_own_ab12cd34\\" to \\"owner_ab12cd34\\" on \\"profiles\\"","operationClass":"widening","target":{"id":"postgres","details":{"schema":"public","objectType":"rlsPolicy","name":"owner_ab12cd34","table":"profiles"}},"precheck":[{"description":"ensure RLS policy \\"read_own_ab12cd34\\" exists","sql":"SELECT 1","params":[],"expectation":{"expects":"present","object":"RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\""}},{"description":"ensure RLS policy \\"owner_ab12cd34\\" does not exist","sql":"SELECT 1","params":[],"expectation":{"expects":"absent","object":"RLS policy \\"owner_ab12cd34\\" on \\"profiles\\""}}],"execute":[{"description":"rename RLS policy \\"read_own_ab12cd34\\" to \\"owner_ab12cd34\\"","sql":"SELECT 1","params":[]}],"postcheck":[{"description":"verify RLS policy \\"owner_ab12cd34\\" exists","sql":"SELECT 1","params":[],"expectation":{"expects":"present","object":"RLS policy \\"owner_ab12cd34\\" on \\"profiles\\""}},{"description":"verify RLS policy \\"read_own_ab12cd34\\" no longer exists","sql":"SELECT 1","params":[],"expectation":{"expects":"absent","object":"RLS policy \\"read_own_ab12cd34\\" on \\"profiles\\""}}]}',
};

describe('row-level-security operations as ops.json records them', () => {
  it.each([
    ['createRlsPolicy', () => createRlsPolicy('public', 'profiles', policy, lowerer)],
    ['dropRlsPolicy', () => dropRlsPolicy('public', 'profiles', 'read_own_ab12cd34', lowerer)],
    ['enableRowLevelSecurity', () => enableRowLevelSecurity('public', 'profiles', lowerer)],
    ['disableRowLevelSecurity', () => disableRowLevelSecurity('public', 'profiles', lowerer)],
    [
      'renameRlsPolicy',
      () => renameRlsPolicy('public', 'profiles', 'read_own_ab12cd34', 'owner_ab12cd34', lowerer),
    ],
  ] as const)('%s serializes as it always has', async (name, build) => {
    expect(JSON.stringify(await build())).toBe(RECORDED[name]);
  });
});
