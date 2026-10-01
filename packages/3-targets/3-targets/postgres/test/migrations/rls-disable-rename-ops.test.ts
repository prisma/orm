import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { rlsEnabledAst, rlsPolicyExistsAst } from '../../src/contract-free/checks';
import {
  DisableRowLevelSecurityCall,
  RenamePostgresRlsPolicyCall,
} from '../../src/core/migrations/op-factory-call';
import { disableRowLevelSecurity, renameRlsPolicy } from '../../src/core/migrations/operations/rls';
import { PostgresAlterPolicyRename, PostgresDisableRowLevelSecurity } from '../../src/exports/ddl';

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

const OLD_NAME = 'read_own_profiles_ab12cd34';
const NEW_NAME = 'owner_read_profiles_ab12cd34';

describe('disableRowLevelSecurity op', () => {
  it('passes the correct PostgresDisableRowLevelSecurity node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await disableRowLevelSecurity('public', 'profiles', lowerer);
    const ddlNode = received.find(
      (n) => n instanceof PostgresDisableRowLevelSecurity,
    ) as PostgresDisableRowLevelSecurity;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
  });

  it('lowers a parameterized rls-enabled precheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsEnabled());
    expect(op.precheck[0]?.params).toEqual(['p1']);
  });

  it('lowers a parameterized rls-disabled postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(received).toContainEqual(rlsEnabledAst('public', 'profiles').rlsDisabled());
    // Call order: enabled (p1), DDL node (p2), disabled (p3)
    expect(op.postcheck[0]?.params).toEqual(['p3']);
  });

  it('operationClass is destructive — disabling RLS opens row access', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.operationClass).toBe('destructive');
  });

  it('op id and label name the table and the disable action', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await disableRowLevelSecurity('public', 'profiles', lowerer);
    expect(op.id).toBe('rowLevelSecurity.public.profiles.disable');
    expect(op.label).toBe('Disable row-level security on "profiles"');
  });
});

describe('renameRlsPolicy op', () => {
  it('passes the correct PostgresAlterPolicyRename node to the lowerer', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    const ddlNode = received.find(
      (n) => n instanceof PostgresAlterPolicyRename,
    ) as PostgresAlterPolicyRename;
    expect(ddlNode).toBeDefined();
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('profiles');
    expect(ddlNode.name).toBe(OLD_NAME);
    expect(ddlNode.newName).toBe(NEW_NAME);
  });

  it('lowers a parameterized old-name-present precheck (names never inlined)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: OLD_NAME,
      }).policyPresent(),
    );
    expect(op.precheck[0]?.params).toEqual(['p1']);
    // The op-level test can only pin that the right check AST (carrying the
    // name) is lowered; the recording lowerer stubs the SQL, so asserting the
    // name is absent from `op.precheck[0].sql` here would be vacuous. The real
    // param-binding safety is rendered through the actual adapter lowerer in
    // adapter-postgres `verification-checks-lowering.test.ts`.
  });

  it('lowers a parameterized new-name-present postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(received).toContainEqual(
      rlsPolicyExistsAst({
        schema: 'public',
        table: 'profiles',
        policyName: NEW_NAME,
      }).policyPresent(),
    );
    // Call order: old present (p1), DDL node (p2), new present (p3)
    expect(op.postcheck[0]?.params).toEqual(['p3']);
  });

  it('operationClass is widening — a rename never plans as a drop', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(op.operationClass).toBe('widening');
  });

  it('op id and label name both policy names', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer);
    expect(op.id).toBe(`rlsPolicy.public.profiles.${OLD_NAME}.rename`);
    expect(op.label).toBe(`Rename RLS policy "${OLD_NAME}" to "${NEW_NAME}" on "profiles"`);
  });
});

describe('DisableRowLevelSecurityCall', () => {
  it('toOp() passes the same DDL node as disableRowLevelSecurity()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    await disableRowLevelSecurity('public', 'profiles', lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof PostgresDisableRowLevelSecurity);
    const ddlNode2 = received2.find((n) => n instanceof PostgresDisableRowLevelSecurity);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.renderTypeScript()).toBe(
      'this.disableRowLevelSecurity({ schema: "public", table: "profiles" })',
    );
  });

  it('factoryName is disableRowLevelSecurity', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.factoryName).toBe('disableRowLevelSecurity');
  });

  it('operationClass is destructive', () => {
    const call = new DisableRowLevelSecurityCall('public', 'profiles');
    expect(call.operationClass).toBe('destructive');
  });
});

describe('RenamePostgresRlsPolicyCall', () => {
  it('toOp() passes the same DDL node as renameRlsPolicy()', async () => {
    const { lowerer: lowerer1, received: received1 } = recordingCheckLowerer();
    const { lowerer: lowerer2, received: received2 } = recordingCheckLowerer();
    const call = new RenamePostgresRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    await renameRlsPolicy('public', 'profiles', OLD_NAME, NEW_NAME, lowerer1);
    await call.toOp(lowerer2);
    const ddlNode1 = received1.find((n) => n instanceof PostgresAlterPolicyRename);
    const ddlNode2 = received2.find((n) => n instanceof PostgresAlterPolicyRename);
    expect(ddlNode1).toEqual(ddlNode2);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenamePostgresRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() round-trips the call', () => {
    const call = new RenamePostgresRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.renderTypeScript()).toBe(
      `this.renameRlsPolicy({ schema: "public", table: "profiles", from: "${OLD_NAME}", to: "${NEW_NAME}" })`,
    );
  });

  it('factoryName is renameRlsPolicy', () => {
    const call = new RenamePostgresRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.factoryName).toBe('renameRlsPolicy');
  });

  it('operationClass is widening — plans without the destructive allowance', () => {
    const call = new RenamePostgresRlsPolicyCall('public', 'profiles', OLD_NAME, NEW_NAME);
    expect(call.operationClass).toBe('widening');
  });
});
