import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type {
  ExecuteRequestLowerer,
  SqlControlAdapter,
} from '@internal/family-sql/control-adapter';
import {
  APP_SPACE_ID,
  type ControlStack,
  planOriginOf,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { columnExistsAst, columnNameTakenAst } from '../../src/contract-free/checks';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { RenameColumnCall } from '../../src/core/migrations/op-factory-call';
import { renameColumn } from '../../src/core/migrations/operations/columns';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { SqliteMigration } from '../../src/core/migrations/sqlite-migration';
import { sqliteColumnRenameCall } from '../../src/core/migrations/table-rename-calls';
import { renameColumnInSqliteSchema } from '../../src/core/migrations/working-schema';
import { SqliteContractSerializer } from '../../src/core/sqlite-contract-serializer';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { ORIGINAL_COLUMNS, type ProfileObjects, profileContract } from './rename-column-fixtures';
import { stubLowerer } from './rename-table-fixtures';

const EMAIL_RENAMED = { ...ORIGINAL_COLUMNS, email: 'emailAddress' };
const NS = asNamespaceId(UNBOUND_NAMESPACE_ID);
const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({ sql: `LOWERED ${received.length}`, params: Object.freeze([]) });
    },
    renderColumnDefault: async () => '',
  };
  return { lowerer, received };
}

function contracts(objects: ProfileObjects = {}) {
  return {
    from: profileContract('from', { objects }),
    to: profileContract('to', { columns: EMAIL_RENAMED, objects }),
  };
}

function renameField(
  model: string,
  from: string,
  to: string,
  newModel = model,
): ResolvedFieldRenameStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: NS, model, field: from },
    to: { namespaceId: NS, model: newModel, field: to },
  };
}

function renameModel(from: string, to: string): ResolvedModelRenameStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: NS, model: from },
    to: { namespaceId: NS, model: to },
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
) {
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: sqliteTestComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return (await Promise.all(result.plan.operations)).map((op) => op.label);
}

describe('renameColumn (sqlite)', () => {
  it('renders ALTER TABLE ... RENAME COLUMN with checks on both names', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameColumn('User', 'name', 'fullName', lowerer);
    expect(op).toMatchObject({
      id: 'renameColumn.User.name',
      label: 'Rename column name on User to fullName',
      operationClass: 'widening',
      execute: [{ sql: 'ALTER TABLE "User" RENAME COLUMN "name" TO "fullName"' }],
    });
    expect(received).toEqual([
      columnExistsAst('User', 'name').columnPresent(),
      columnNameTakenAst('User', 'fullName').nameFree(),
      columnExistsAst('User', 'fullName').columnPresent(),
      columnExistsAst('User', 'name').columnAbsent(),
    ]);
    expect(op.precheck.map((step) => step.expectation)).toEqual([
      { expects: 'present', object: 'column "name" on "User"' },
      { expects: 'absent', object: 'a column named "fullName" on "User" in any case' },
    ]);
    expect(op.postcheck).toHaveLength(2);
  });

  it('renames a column whose name changes only in case in one statement, checking the new name exactly', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const op = await renameColumn('User', 'name', 'Name', lowerer);
    expect(received[1]).toEqual(columnExistsAst('User', 'Name').columnAbsent());
    expect(op.precheck[1]?.expectation).toEqual({
      expects: 'absent',
      object: 'column "Name" on "User"',
    });
    expect(op.execute.map((step) => step.sql)).toEqual([
      'ALTER TABLE "User" RENAME COLUMN "name" TO "Name"',
    ]);
  });

  it('RenameColumnCall renders the facade call', () => {
    expect(new RenameColumnCall('User', 'name', 'fullName', []).renderTypeScript()).toBe(
      '...this.renameColumn({ table: "User", column: "name", to: "fullName" })',
    );
  });
});

describe('sqliteColumnRenameCall', () => {
  function labelsFor(objects: ProfileObjects): readonly string[] {
    const { from, to } = contracts(objects);
    const call = sqliteColumnRenameCall({
      previous: sqliteContractToSchema(from, sqliteTestTypes),
      contract: to,
      rename: {
        namespaceId: UNBOUND_NAMESPACE_ID,
        table: 'Profile',
        from: 'email',
        to: 'emailAddress',
      },
      frameworkComponents: sqliteTestComponents,
    });
    return [call.label, ...call.companions.map((companion) => companion.label)];
  }

  it('replaces an index on the column with one under the destination wire name', () => {
    const [rename, drop, create, ...rest] = labelsFor({ emailIndex: true });
    expect(rename).toBe('Rename column email on Profile to emailAddress');
    expect(drop).toMatch(/^Drop index Profile_email_idx_[0-9a-f]+ on Profile$/);
    expect(create).toMatch(/^Create index Profile_emailAddress_idx_[0-9a-f]+ on Profile$/);
    expect(rest).toEqual([]);
  });

  it('follows the column in foreign keys that reference it from another table', () => {
    const renamed = renameColumnInSqliteSchema(
      sqliteContractToSchema(profileContract('from'), sqliteTestTypes),
      {
        table: 'Profile',
        from: 'id',
        to: 'profileId',
      },
    );
    expect(renamed.tables['post']?.foreignKeys.map((fk) => fk.referencedColumns)).toEqual([
      ['profileId'],
    ]);
  });
});

const stack = {
  adapter: {
    ...sqliteTestComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'sqlite'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'sqlite' },
  extensions: [],
} as unknown as ControlStack<'sql', 'sqlite'>;

function migration(
  start: Contract<SqlStorage>,
  end: Contract<SqlStorage>,
  build: (m: {
    renameTable: (o: { table: string; to: string }) => readonly Promise<unknown>[];
    renameColumn: (o: { table: string; column: string; to: string }) => readonly Promise<unknown>[];
  }) => readonly Promise<unknown>[],
) {
  const serializer = new SqliteContractSerializer();
  const startJson = serializer.serializeContract(start) as never;
  const endJson = serializer.serializeContract(end) as never;
  class HandWritten extends SqliteMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations() {
      return build({
        renameTable: (o) => this.renameTable(o),
        renameColumn: (o) => this.renameColumn(o),
      }) as never;
    }
  }
  return new HandWritten(stack);
}

describe('SqliteMigration.renameColumn', () => {
  it('renames a column of a table an earlier renameTable renamed', async () => {
    const objects = { emailIndex: true };
    const ops = (await Promise.all(
      migration(
        profileContract('from', { objects }),
        profileContract('to', { table: 'User', columns: EMAIL_RENAMED, objects }),
        (m) => [
          ...m.renameTable({ table: 'Profile', to: 'User' }),
          ...m.renameColumn({ table: 'User', column: 'email', to: 'emailAddress' }),
        ],
      ).operations,
    )) as readonly { label: string }[];
    const labels = ops.map((op) => op.label);
    expect(labels[0]).toBe('Rename table Profile to User');
    expect(labels).toContain('Rename column email on User to emailAddress');
    expect(labels.at(-1)).toMatch(/^Create index User_emailAddress_idx_/);
  });

  it('refuses a column the table does not have', () => {
    const m = migration(
      profileContract('from'),
      profileContract('to', { columns: EMAIL_RENAMED }),
      (h) => h.renameColumn({ table: 'Profile', column: 'nickname', to: 'emailAddress' }),
    );
    expect(() => m.operations).toThrow(
      expect.objectContaining({ code: 'MIGRATION.COLUMN_RENAME_UNMATCHED' }),
    );
  });
});

describe('SQLite planner, field statements', () => {
  const renameEmail = renameField('Profile', 'email', 'emailAddress');

  it('plans the column rename and its index replacement in place of a drop and add', async () => {
    const { from, to } = contracts({ emailIndex: true });
    const labels = await labelsOf(plan(from, to, [renameEmail]));
    expect(labels[0]).toBe('Rename column email on Profile to emailAddress');
    expect(labels).toHaveLength(3);
    expect(labels.some((label) => label.startsWith('Drop column'))).toBe(false);
  });

  it('reports the statement with the positions of the operations it accounts for', () => {
    const { from, to } = contracts({ emailIndex: true });
    const result = plan(from, to, [renameEmail]);
    if (result.kind !== 'success') throw new Error('expected a plan');
    expect(result.appliedStatements).toEqual([
      { statement: renameEmail, operationIndexes: [0, 1, 2] },
    ]);
  });

  it('applies a statement whose column does not change with no operations', async () => {
    const result = plan(profileContract('from'), profileContract('to', { fields: EMAIL_RENAMED }), [
      renameEmail,
    ]);
    expect(await labelsOf(result)).toEqual([]);
  });

  it('applies a relation field statement with no operations', async () => {
    const result = plan(profileContract('from'), profileContract('from'), [
      renameField('Profile', 'posts', 'posts'),
    ]);
    expect(await labelsOf(result)).toEqual([]);
  });

  it('emits the same operations as the facade call it renders, run against the same contracts', async () => {
    const objects = { emailIndex: true };
    const from = profileContract('a'.repeat(64), { objects });
    const to = profileContract('b'.repeat(64), { columns: EMAIL_RENAMED, objects });
    const result = plan(from, to, [renameEmail]);
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    expect(result.plan.renderTypeScript(workspaceMigrationModule.sqlite)).toContain(
      '...this.renameColumn({ table: "Profile", column: "email", to: "emailAddress" })',
    );
    const planned = await Promise.all(result.plan.operations);
    const handWritten = await Promise.all(
      migration(from, to, (m) =>
        m.renameColumn({ table: 'Profile', column: 'email', to: 'emailAddress' }),
      ).operations,
    );
    expect(handWritten).toEqual(planned);
    expect(planned).toHaveLength(3);
  });

  it('renames the column on the table an earlier model statement renamed', async () => {
    const from = profileContract('from');
    const to = profileContract('to', { table: 'User', columns: EMAIL_RENAMED });
    expect(
      await labelsOf(
        plan(from, to, [
          renameModel('Profile', 'User'),
          renameField('Profile', 'email', 'emailAddress', 'User'),
        ]),
      ),
    ).toEqual(['Rename table Profile to User', 'Rename column email on User to emailAddress']);
  });

  it('renames the column on the table the plan renames for a model that keeps its name', async () => {
    const from = profileContract('from');
    const to = profileContract('to', { table: 'User', model: 'Profile', columns: EMAIL_RENAMED });
    const statement = renameField('Profile', 'email', 'emailAddress');
    const result = plan(from, to, [statement]);
    expect(await labelsOf(result)).toEqual([
      'Rename table Profile to User',
      'Rename column email on User to emailAddress',
    ]);
    expect(result.kind === 'success' && result.appliedStatements).toEqual([
      { statement, operationIndexes: [1] },
    ]);
  });
});
