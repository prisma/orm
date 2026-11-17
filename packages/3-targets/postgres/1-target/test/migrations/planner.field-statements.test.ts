import { asNamespaceId, type Contract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedFieldRenameStatement,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresMigration } from '../../src/core/migrations/postgres-migration';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import type { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { ORIGINAL_COLUMNS, type ProfileObjects, profileContract } from './rename-column-fixtures';
import { stubLowerer } from './rename-table-fixtures';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;
type ContractJson = { readonly storage: { readonly storageHash: string } };

const stack = {
  adapter: {
    ...postgresTypeComponents[0],
    create: () => stubLowerer as unknown as SqlControlAdapter<'postgres'>,
  },
  target: { kind: 'target', familyId: 'sql', targetId: 'postgres' },
  extensions: [],
} as unknown as ControlStack<'sql', 'postgres'>;

function jsonOf(contract: Contract<SqlStorage>): ContractJson {
  return new PostgresContractSerializer().serializeContract(contract) as unknown as ContractJson;
}

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
const NS = asNamespaceId(UNBOUND_NAMESPACE_ID);
const EMAIL_RENAMED = { ...ORIGINAL_COLUMNS, email: 'emailAddress' };

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
  schema: PostgresDatabaseSchemaNode = postgresContractToSchema(from, postgresTypeComponents),
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema,
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

function success(result: ReturnType<typeof plan>) {
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  const ops = await Promise.all(success(result).plan.operations);
  return ops.map((op) => op.label);
}

function contracts(objects: ProfileObjects = {}) {
  return {
    from: profileContract('from', { objects }),
    to: profileContract('to', { columns: EMAIL_RENAMED, objects }),
  };
}

const renameEmail = renameField('Profile', 'email', 'emailAddress');

describe('Postgres planner, field statements', () => {
  it('plans the column rename and its companions in place of a drop and add', async () => {
    const { from, to } = contracts({ emailUnique: {} });
    expect(await labelsOf(plan(from, to, [renameEmail]))).toEqual([
      'Rename column "Profile"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "Profile_emailAddress_key" on "Profile"',
    ]);
  });

  it('drops and adds the column without a statement', async () => {
    const { from, to } = contracts();
    const labels = await labelsOf(plan(from, to, []));
    expect(labels).toEqual([
      'Drop column "email" from "Profile"',
      'Add column emailAddress to Profile',
    ]);
  });

  it('reports the statement with the positions of the operations it accounts for', () => {
    const { from, to } = contracts({ emailUnique: {} });
    const result = success(plan(from, to, [renameEmail]));
    expect(result.appliedStatements).toEqual([
      { statement: renameEmail, operationIndexes: [0, 1] },
    ]);
  });

  it('applies a statement whose column does not change with no operations', async () => {
    const from = profileContract('from');
    const to = profileContract('to', { fields: EMAIL_RENAMED });
    const result = plan(from, to, [renameEmail]);
    expect(await labelsOf(result)).toEqual([]);
    expect(success(result).appliedStatements).toEqual([
      expect.objectContaining({ operationIndexes: [] }),
    ]);
  });

  it('applies a relation field statement with no operations', async () => {
    const from = profileContract('from');
    const result = plan(from, profileContract('from'), [renameField('Profile', 'posts', 'posts')]);
    expect(await labelsOf(result)).toEqual([]);
    expect(success(result).appliedStatements).toEqual([
      expect.objectContaining({ operationIndexes: [] }),
    ]);
  });

  it('renames the column on the table an earlier model statement renamed', async () => {
    const objects = { emailUnique: {} };
    const from = profileContract('from', { objects });
    const to = profileContract('to', { table: 'User', columns: EMAIL_RENAMED, objects });
    const result = plan(from, to, [
      renameModel('Profile', 'User'),
      renameField('Profile', 'email', 'emailAddress', 'User'),
    ]);
    expect(await labelsOf(result)).toEqual([
      'Rename table "Profile" to "User"',
      'Rename primary key "Profile_pkey" to "User_pkey" on "User"',
      'Rename column "User"."email" to "emailAddress"',
      'Rename unique constraint "Profile_email_key" to "User_emailAddress_key" on "User"',
    ]);
    expect(
      success(result).appliedStatements.map((applied) => applied.operationIndexes.length),
    ).toEqual([2, 2]);
  });

  it('replaces a check on the column after the rename', async () => {
    const { from, to } = contracts({ emailCheck: true });
    const labels = await labelsOf(plan(from, to, [renameEmail]));
    expect(labels[0]).toBe('Rename column "Profile"."email" to "emailAddress"');
    expect(labels.slice(1).some((label) => label.startsWith('Drop check constraint'))).toBe(true);
    expect(labels.slice(1).some((label) => label.startsWith('Add check constraint'))).toBe(true);
  });

  it('replaces an index with a predicate on the column after the rename', async () => {
    const { from, to } = contracts({ emailPartialIndex: true });
    const labels = await labelsOf(plan(from, to, [renameEmail]));
    expect(labels[0]).toBe('Rename column "Profile"."email" to "emailAddress"');
    expect(labels.slice(1).some((label) => label.startsWith('Drop index'))).toBe(true);
    expect(labels.slice(1).some((label) => label.startsWith('Create index'))).toBe(true);
  });

  it('refuses a rename whose column the schema being planned from does not have', () => {
    const { from, to } = contracts();
    const otherSchema = postgresContractToSchema(
      profileContract('other', { columns: EMAIL_RENAMED }),
      postgresTypeComponents,
    );
    const result = plan(from, to, [renameEmail], otherSchema);
    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        refusedStatement: renameEmail,
        summary: expect.stringContaining('has no column "email"'),
      }),
    ]);
  });

  it('refuses a rename on a table the destination renames, naming the renameTable call to write by hand', () => {
    const from = profileContract('from');
    const to = profileContract('to', { table: 'User', columns: EMAIL_RENAMED });
    const statement = renameField('Profile', 'email', 'emailAddress', 'User');
    const result = plan(from, to, [statement]);
    expect(result.kind === 'failure' && result.conflicts).toEqual([
      expect.objectContaining({
        kind: 'statementRefused',
        refusedStatement: statement,
        why: expect.stringContaining(
          'add ...this.renameTable({ table: "Profile", to: "User" }) to the operations of its migration.ts',
        ),
      }),
    ]);
    expect(result.kind === 'failure' && result.conflicts[0]?.why).toContain(
      'With db update, change the contract so that only the table name changes, and run prisma contract emit. Rename the table in the database yourself with ALTER TABLE "Profile" RENAME TO "User", check that prisma db update --dry-run plans no drop of a table or column, and run prisma db update to store that contract. Then emit the final contract and run prisma db update --rename User.email:User.emailAddress.',
    );
  });

  it('emits the same operations as the facade call it renders, run against the same contracts', async () => {
    const objects = { emailUnique: {}, emailIndex: true };
    const from = profileContract('a'.repeat(64), { objects });
    const to = profileContract('b'.repeat(64), { columns: EMAIL_RENAMED, objects });
    const result = success(plan(from, to, [renameEmail]));
    const rendered =
      '...this.renameColumn({ table: "Profile", column: "email", to: "emailAddress" })';
    expect(result.plan.renderTypeScript((specifier) => specifier)).toContain(rendered);

    const startJson = jsonOf(from);
    const endJson = jsonOf(to);
    class HandWritten extends PostgresMigration {
      override readonly startContractJson = startJson;
      override readonly endContractJson = endJson;
      override get operations(): readonly Promise<Op>[] {
        return [...this.renameColumn({ table: 'Profile', column: 'email', to: 'emailAddress' })];
      }
    }
    const planned = await Promise.all(result.plan.operations);
    const handWritten = await Promise.all(new HandWritten(stack).operations);
    expect(handWritten).toEqual(planned);
    expect(planned.map((op) => op.id)).toEqual([
      'renameColumn.Profile.email',
      expect.stringContaining('Profile_email_key'),
      expect.stringContaining('Profile_email_idx'),
    ]);
  });
});
