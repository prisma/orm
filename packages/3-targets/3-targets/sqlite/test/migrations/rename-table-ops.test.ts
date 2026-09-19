import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import { tableExistsAst } from '../../src/contract-free/checks';
import { RenameTableCall } from '../../src/core/migrations/op-factory-call';

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

describe('RenameTableCall (sqlite)', () => {
  it('is a widening renameTable call whose contract-side identity is the new name', () => {
    const call = new RenameTableCall('userProfile', 'UserProfile');

    expect(call).toMatchObject({
      factoryName: 'renameTable',
      operationClass: 'widening',
      oldTableName: 'userProfile',
      tableName: 'UserProfile',
      label: 'Rename table userProfile to UserProfile',
    });
  });

  it('renders ALTER TABLE ... RENAME TO with existence prechecks and a postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await new RenameTableCall('profile', 'account').toOp(lowerer);

    expect(received).toEqual([
      tableExistsAst('profile').tablePresent(),
      tableExistsAst('account').tableAbsent(),
      tableExistsAst('account').tablePresent(),
      tableExistsAst('profile').tableAbsent(),
    ]);
    expect(op).toEqual({
      id: 'renameTable.profile',
      label: 'Rename table profile to account',
      summary: 'Renames table profile to account, keeping its rows',
      operationClass: 'widening',
      target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'account' } },
      precheck: [
        { description: 'ensure table "profile" exists', sql: 'LOWERED 1', params: ['p1'] },
        { description: 'ensure table "account" does not exist', sql: 'LOWERED 2', params: ['p2'] },
      ],
      execute: [
        {
          description: 'rename table "profile" to "account"',
          sql: 'ALTER TABLE "profile" RENAME TO "account"',
        },
      ],
      postcheck: [
        { description: 'verify table "account" exists', sql: 'LOWERED 3', params: ['p3'] },
        {
          description: 'verify table "profile" no longer exists',
          sql: 'LOWERED 4',
          params: ['p4'],
        },
      ],
    });
  });

  it('renames through a temporary name when only the case changes, which SQLite would otherwise refuse', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await new RenameTableCall('userProfile', 'UserProfile').toOp(lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"',
      'ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile"',
    ]);
  });

  it('renames in one statement when only a non-ASCII letter changes case, since SQLite folds only ASCII letters', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await new RenameTableCall('Äpfel', 'äpfel').toOp(lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual(['ALTER TABLE "Äpfel" RENAME TO "äpfel"']);
    expect(received).not.toContainEqual(tableExistsAst('_prisma_rename_äpfel').tableAbsent());
  });

  it('prechecks that the temporary name is free on a case-only rename, saying why it is needed', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await new RenameTableCall('userProfile', 'UserProfile').toOp(lowerer);

    expect(received).toEqual([
      tableExistsAst('userProfile').tablePresent(),
      tableExistsAst('UserProfile').tableAbsent(),
      tableExistsAst('_prisma_rename_UserProfile').tableAbsent(),
      tableExistsAst('UserProfile').tablePresent(),
      tableExistsAst('userProfile').tableAbsent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure table "userProfile" exists', sql: 'LOWERED 1', params: ['p1'] },
      {
        description: 'ensure table "UserProfile" does not exist',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
      {
        description:
          'ensure table "_prisma_rename_UserProfile" does not exist (a rename that only changes case passes through this temporary name, because SQLite compares table names without case)',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
  });

  it('toOp() without a lowerer reports MIGRATION.SQLITE_CONTROL_STACK_MISSING', async () => {
    const call = new RenameTableCall('userProfile', 'UserProfile');
    await expect(call.toOp()).rejects.toMatchObject({
      code: 'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
      meta: { factory: 'renameTable' },
    });
  });

  it('renderTypeScript() spreads the facade call, which returns every rename', () => {
    expect(new RenameTableCall('userProfile', 'UserProfile').renderTypeScript()).toBe(
      '...this.renameTable({ table: "userProfile", to: "UserProfile" })',
    );
  });

  it('needs no facade import because the call is a method on the migration', () => {
    expect(new RenameTableCall('a', 'b').importRequirements()).toEqual([]);
  });
});
