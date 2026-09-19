import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { tableExistsAst } from '../../src/contract-free/checks';
import { RenameTableCall } from '../../src/core/migrations/op-factory-call';
import { renameTable } from '../../src/core/migrations/operations/tables';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
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

describe('renameTable (postgres)', () => {
  it('renders a schema-qualified ALTER TABLE ... RENAME TO', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameTable('auth', 'userProfile', 'UserProfile', lowerer);

    expect(op).toMatchObject({
      id: 'renameTable.userProfile',
      label: 'Rename table "userProfile" to "UserProfile"',
      operationClass: 'widening',
      target: {
        id: 'postgres',
        details: { schema: 'auth', objectType: 'table', name: 'UserProfile' },
      },
      execute: [
        {
          description: 'rename table "userProfile" to "UserProfile"',
          sql: 'ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"',
        },
      ],
    });
  });

  it('renders an unqualified statement for the unbound namespace', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameTable(UNBOUND_NAMESPACE_ID, 'userProfile', 'UserProfile', lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('prechecks that the old table exists and the new one does not, then postchecks both', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameTable('public', 'userProfile', 'UserProfile', lowerer);

    expect(received).toEqual([
      tableExistsAst('public', 'userProfile').tablePresent(),
      tableExistsAst('public', 'UserProfile').tableAbsent(),
      tableExistsAst('public', 'UserProfile').tablePresent(),
      tableExistsAst('public', 'userProfile').tableAbsent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure table "userProfile" exists', sql: 'LOWERED 1', params: ['p1'] },
      {
        description: 'ensure table "UserProfile" does not exist',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify table "UserProfile" exists', sql: 'LOWERED 3', params: ['p3'] },
      {
        description: 'verify table "userProfile" no longer exists',
        sql: 'LOWERED 4',
        params: ['p4'],
      },
    ]);
  });
});

describe('RenameTableCall (postgres)', () => {
  it('is a widening renameTable call whose contract-side identity is the new name', () => {
    const call = new RenameTableCall('public', 'userProfile', 'UserProfile');

    expect(call).toMatchObject({
      factoryName: 'renameTable',
      operationClass: 'widening',
      schemaName: 'public',
      oldTableName: 'userProfile',
      tableName: 'UserProfile',
      label: 'Rename table "userProfile" to "UserProfile"',
    });
  });

  it('toOp() delegates to renameTable', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await new RenameTableCall('auth', 'userProfile', 'UserProfile').toOp(lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('toOp() without a lowerer reports MIGRATION.POSTGRES_CONTROL_STACK_MISSING', async () => {
    const call = new RenameTableCall('public', 'userProfile', 'UserProfile');
    await expect(call.toOp()).rejects.toMatchObject({
      code: 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
      meta: { factory: 'RenameTableCall' },
    });
  });

  it('renderTypeScript() spreads the facade call, which returns every rename, schema-qualified only when bound', () => {
    expect(new RenameTableCall('auth', 'userProfile', 'UserProfile').renderTypeScript()).toBe(
      '...this.renameTable({ schema: "auth", table: "userProfile", to: "UserProfile" })',
    );
    expect(
      new RenameTableCall(UNBOUND_NAMESPACE_ID, 'userProfile', 'UserProfile').renderTypeScript(),
    ).toBe('...this.renameTable({ table: "userProfile", to: "UserProfile" })');
  });

  it('needs no facade import because the call is a method on the migration', () => {
    expect(new RenameTableCall('public', 'a', 'b').importRequirements()).toEqual([]);
  });
});
