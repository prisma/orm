import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { rlsEnabledAst, rlsPolicyExistsAst } from '../../src/contract-free/checks';
import {
  CreatePostgresRlsPolicyCall,
  DropPostgresRlsPolicyCall,
  EnableRowLevelSecurityCall,
} from '../../src/core/migrations/op-factory-call';
import {
  createRlsPolicy,
  dropRlsPolicy,
  enableRowLevelSecurity,
} from '../../src/core/migrations/operations/rls';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresCreatePolicy, PostgresDropPolicy } from '../../src/exports/ddl';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('renderCreatePolicySql role-name validation', () => {
  function policyWithRoles(roles: string[]): PostgresRlsPolicy {
    return new PostgresRlsPolicy({
      naming: parseNaming('p_ab12cd34', 'p'),
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'select',
      roles,
      using: '(true)',
      permissive: true,
      withCheck: undefined,
    });
  }

  it('renders TO PUBLIC when roles is empty', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', policyWithRoles([]), lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toHaveLength(0);
  });

  it('renders a plain SQL identifier role without error', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', policyWithRoles(['app_user']), lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toEqual(['app_user']);
  });

  it('renders multiple valid role names', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy(
      'public',
      'profiles',
      policyWithRoles(['app_user', 'read_only']),
      lowerer,
    );
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.roles).toEqual(['app_user', 'read_only']);
  });

  it('rejects a role name containing a double-quote', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['a"b']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a space', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['my role']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });

  it('rejects a role name containing a semicolon', async () => {
    const { lowerer } = recordingCheckLowerer();
    await expect(
      createRlsPolicy('public', 'profiles', policyWithRoles(['role;DROP TABLE']), lowerer),
    ).rejects.toThrow(/invalid role name/i);
  });
});

const basePolicy = new PostgresRlsPolicy({
  naming: parseNaming('read_own_profiles_ab12cd34', 'read_own_profiles'),
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select',
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
  withCheck: undefined,
});

describe('createRlsPolicy op', () => {
  it('passes the correct PostgresCreatePolicy node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.name).toBe('read_own_profiles_ab12cd34');
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
    expect(ddlNode.permissive).toBe(true);
    expect(ddlNode.operation).toBe('select');
    expect(ddlNode.roles).toEqual(['authenticated']);
    expect(ddlNode.using).toBe('(auth.uid() = user_id)');
    expect(ddlNode.withCheck).toBeUndefined();
  });

  it('passes withCheck when present', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = new PostgresRlsPolicy({
      naming: parseNaming('insert_own_profiles_ab12cd34', 'insert_own_profiles'),
      tableName: 'profiles',
      namespaceId: 'public',
      operation: 'insert',
      roles: ['authenticated'],
      withCheck: '(auth.uid() = user_id)',
      permissive: true,
      using: undefined,
    });
    await createRlsPolicy('public', 'profiles', policy, lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.withCheck).toBe('(auth.uid() = user_id)');
    expect(ddlNode.using).toBeUndefined();
  });

  it('passes permissive: false for RESTRICTIVE policies', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = new PostgresRlsPolicy({
      ...basePolicy,
      using: basePolicy.using,
      withCheck: basePolicy.withCheck,
      naming: parseNaming('restrict_profiles_ab12cd34', 'restrict_profiles'),
      permissive: false,
    });
    await createRlsPolicy('public', 'profiles', policy, lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresCreatePolicy) as PostgresCreatePolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.permissive).toBe(false);
  });

  it('lowers a parameterized policy-absent precheck (name never inlined)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyAbsent(),
    );
    expect(op.precheck[0]?.params).toEqual(['p1']);
    // Recording lowerer stubs the SQL, so a not-contains assertion on it is
    // vacuous — real param-binding safety is pinned through the actual adapter
    // lowerer in adapter-postgres `verification-checks-lowering.test.ts`.
  });

  it('lowers a parameterized policy-present postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyPresent(),
    );
    // Call order: absent (p1), DDL node (p2), present (p3)
    expect(op.postcheck[0]?.params).toEqual(['p3']);
  });

  it('operationClass is additive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await createRlsPolicy('public', 'profiles', basePolicy, lowerer);
    expect(op.operationClass).toBe('additive');
  });
});

describe('enableRowLevelSecurity op', () => {
  it('emits the correct ALTER TABLE DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('lowers a parameterized rls-disabled precheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsDisabled());
  });

  it('lowers a parameterized rls-enabled postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsEnabled());
  });

  it('operationClass is additive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await enableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.operationClass).toBe('additive');
  });
});

describe('dropRlsPolicy op', () => {
  it('passes the correct PostgresDropPolicy node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    const ddlNode = received.find((n) => n instanceof PostgresDropPolicy) as PostgresDropPolicy;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.name).toBe('read_own_profiles_ab12cd34');
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
  });

  it('lowers a parameterized policy-present precheck (name never inlined)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyPresent(),
    );
    // Recording lowerer stubs the SQL; the real param-binding safety is pinned
    // through the actual adapter lowerer in adapter-postgres
    // `verification-checks-lowering.test.ts`.
  });

  it('lowers a parameterized policy-absent postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: 'read_own_profiles_ab12cd34',
      }).policyAbsent(),
    );
  });

  it('operationClass is destructive', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer);
    expect(op.operationClass).toBe('destructive');
  });
});

describe('CreatePostgresRlsPolicyCall', () => {
  it('toOp() passes the same DDL node as createRlsPolicy()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    await createRlsPolicy('public', 'profiles', basePolicy, lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof PostgresCreatePolicy);
    const ddlNode2 = received2.find((n) => n instanceof PostgresCreatePolicy);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('createRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is createRlsPolicy', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.factoryName).toBe('createRlsPolicy');
  });

  it('operationClass is additive', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'profiles', basePolicy);
    expect(call.operationClass).toBe('additive');
  });
});

describe('EnableRowLevelSecurityCall', () => {
  it('toOp() returns the correct DDL', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const op = await call.toOp(lowerer);
    expect(op.execute[0]?.sql).toBe(`ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY`);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('enableRowLevelSecurity');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
  });

  it('factoryName is enableRowLevelSecurity', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.factoryName).toBe('enableRowLevelSecurity');
  });

  it('operationClass is additive', () => {
    const call = new EnableRowLevelSecurityCall('public', 'profiles');
    expect(call.operationClass).toBe('additive');
  });
});

describe('DropPostgresRlsPolicyCall', () => {
  it('toOp() passes the same DDL node as dropRlsPolicy()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    await dropRlsPolicy('public', 'profiles', 'read_own_profiles_ab12cd34', lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof PostgresDropPolicy);
    const ddlNode2 = received2.find((n) => n instanceof PostgresDropPolicy);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    const rendered = call.renderTypeScript();
    expect(rendered).toContain('dropRlsPolicy');
    expect(rendered).toContain('public');
    expect(rendered).toContain('profiles');
    expect(rendered).toContain('read_own_profiles_ab12cd34');
  });

  it('factoryName is dropRlsPolicy', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.factoryName).toBe('dropRlsPolicy');
  });

  it('operationClass is destructive', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'profiles', 'read_own_profiles_ab12cd34');
    expect(call.operationClass).toBe('destructive');
  });
});
