import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { columnExistsAst } from '../../src/contract-free/checks';
import { RenameColumnCall, RenameConstraintCall } from '../../src/core/migrations/op-factory-call';
import { renameColumn } from '../../src/core/migrations/operations/columns';

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
    renderColumnDefault: async () => '',
  };
  return { lowerer, received };
}

describe('renameColumn (postgres)', () => {
  it('renders a schema-qualified ALTER TABLE ... RENAME COLUMN', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameColumn('auth', 'User', 'name', 'fullName', lowerer);

    expect(op).toMatchObject({
      id: 'renameColumn.User.name',
      label: 'Rename column "User"."name" to "fullName"',
      operationClass: 'widening',
      target: {
        id: 'postgres',
        details: { schema: 'auth', objectType: 'column', name: 'fullName', table: 'User' },
      },
      execute: [
        {
          description: 'rename column "name" to "fullName"',
          sql: 'ALTER TABLE "auth"."User" RENAME COLUMN "name" TO "fullName"',
        },
      ],
    });
  });

  it('renders an unqualified statement for the unbound namespace, and a case-only rename as is', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await renameColumn(UNBOUND_NAMESPACE_ID, 'User', 'name', 'Name', lowerer);

    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "User" RENAME COLUMN "name" TO "Name"',
    ]);
  });

  it('prechecks that the old column exists and the new one does not, then postchecks both', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameColumn('public', 'User', 'name', 'fullName', lowerer);
    const checks = (column: string) => columnExistsAst({ schema: 'public', table: 'User', column });

    expect(received).toEqual([
      checks('name').columnPresent(),
      checks('name').columnAbsent(),
      checks('fullName').columnPresent(),
      checks('fullName').columnAbsent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "name" exists', sql: 'LOWERED 1', params: ['p1'] },
      { description: 'ensure column "fullName" does not exist', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "fullName" exists', sql: 'LOWERED 3', params: ['p3'] },
      { description: 'verify column "name" no longer exists', sql: 'LOWERED 2', params: ['p2'] },
    ]);
  });
});

describe('RenameColumnCall (postgres)', () => {
  it('is a widening renameColumn call whose contract-side identity is the new name', () => {
    expect(new RenameColumnCall('public', 'User', 'name', 'fullName', [])).toMatchObject({
      factoryName: 'renameColumn',
      operationClass: 'widening',
      schemaName: 'public',
      tableName: 'User',
      oldColumnName: 'name',
      columnName: 'fullName',
      label: 'Rename column "User"."name" to "fullName"',
    });
  });

  it('toOp() without a lowerer reports MIGRATION.POSTGRES_CONTROL_STACK_MISSING', async () => {
    await expect(
      new RenameColumnCall('public', 'User', 'name', 'fullName', []).toOp(),
    ).rejects.toMatchObject({
      code: 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
      meta: { factory: 'RenameColumnCall' },
    });
  });

  it('renderTypeScript() spreads the facade call, schema-qualified only when bound', () => {
    expect(new RenameColumnCall('auth', 'User', 'name', 'fullName', []).renderTypeScript()).toBe(
      '...this.renameColumn({ schema: "auth", table: "User", column: "name", to: "fullName" })',
    );
    expect(
      new RenameColumnCall(UNBOUND_NAMESPACE_ID, 'User', 'name', 'fullName', []).renderTypeScript(),
    ).toBe('...this.renameColumn({ table: "User", column: "name", to: "fullName" })');
  });

  it('toOps() lowers the column rename, then each companion', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new RenameColumnCall('public', 'User', 'name', 'fullName', [
      new RenameConstraintCall('public', 'User', 'unique', 'User_name_key', 'User_fullName_key'),
    ]);
    const ops = await Promise.all(call.toOps(lowerer));
    expect(ops.map((op) => op.id)).toEqual([
      'renameColumn.User.name',
      expect.stringContaining('User_name_key'),
    ]);
  });
});
