import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { index } from '@internal/sql-contract/factories';
import {
  type ReferentialAction,
  SqlStorage,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const anyClass: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } as const;
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } as const;

function foreignKey(
  from: { namespace: string; table: string; column: string },
  to: { namespace: string; table: string; column: string },
  options: { name?: string; onDelete: ReferentialAction; onUpdate: ReferentialAction },
) {
  return {
    source: {
      namespaceId: asNamespaceId(from.namespace),
      tableName: from.table,
      columns: [from.column],
    },
    target: { namespaceId: asNamespaceId(to.namespace), tableName: to.table, columns: [to.column] },
    ...options,
  };
}

function contractOf(name: string, namespaces: Record<string, Record<string, StorageTableInput>>) {
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(name),
    storage: new SqlStorage({
      storageHash: coreHash(name),
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, table]) => [
          id,
          postgresCreateNamespace({ id: asNamespaceId(id), entries: { table } }),
        ]),
      ),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  return contract;
}

const userRef = { namespace: 'public', table: 'User', column: 'id' };

type Audit = 'managed' | 'external' | 'external-unlinked' | 'none';

function auditEntry(audit: Audit): Record<string, StorageTableInput> {
  if (audit === 'none') return {};
  return {
    Entry: {
      columns: { id: int4, userId: int4 },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys:
        audit === 'external-unlinked'
          ? []
          : [
              foreignKey({ namespace: 'audit', table: 'Entry', column: 'userId' }, userRef, {
                onDelete: 'restrict',
                onUpdate: 'cascade',
              }),
            ],
      ...(audit === 'managed' ? {} : { control: 'external' as const }),
    },
  };
}

function blog(edited: boolean, audit: Audit = 'managed'): Contract<SqlStorage> {
  return contractOf(`blog-${edited}-${audit}`, {
    public: {
      User: {
        columns: { id: int4, email: text },
        primaryKey: { columns: edited ? ['id', 'email'] : ['id'] },
        uniques: [],
        indexes: [
          index('User_email_key', ['email'], { unique: true }),
          ...(edited ? [index('User_id_key', ['id'], { unique: true })] : []),
        ],
        foreignKeys: [],
      },
      Post: {
        columns: { id: int4, authorId: int4 },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          foreignKey({ namespace: 'public', table: 'Post', column: 'authorId' }, userRef, {
            name: 'Post_author_fk',
            onDelete: 'restrict',
            onUpdate: 'cascade',
          }),
        ],
      },
      Comment: {
        columns: { id: int4, postId: int4 },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          foreignKey(
            { namespace: 'public', table: 'Comment', column: 'postId' },
            { namespace: 'public', table: 'Post', column: 'id' },
            { onDelete: edited ? 'cascade' : 'restrict', onUpdate: 'cascade' },
          ),
        ],
      },
    },
    ...(audit === 'none' ? {} : { audit: auditEntry(audit) }),
  });
}

function tag(edited: boolean): Contract<SqlStorage> {
  return contractOf(`tag-${edited}`, {
    public: {
      Tag: {
        columns: edited ? { code: text } : { uuid: int4, code: text },
        primaryKey: { columns: edited ? ['code'] : ['uuid'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  });
}

describe('a primary key that moves', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await driver.query('drop schema if exists audit cascade');
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  function contractSchema(contract: Contract<SqlStorage> | null): SqlSchemaIRNode {
    return postgresTargetDescriptor.migrations.contractToSchema(
      contract,
      frameworkComponents,
    ) as SqlSchemaIRNode;
  }

  function plan(
    from: Contract<SqlStorage> | null,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
    schema: SqlSchemaIRNode,
  ) {
    return postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: from,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  async function planAndApply(
    from: Contract<SqlStorage> | null,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
    schema: SqlSchemaIRNode = contractSchema(from),
  ): Promise<readonly string[]> {
    const planResult = plan(from, contract, policy, schema);
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    const migrationPlan = planResult.plan;
    const operations = await Promise.all(migrationPlan.operations);
    const executeResult = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: migrationPlan.spaceId ?? APP_SPACE_ID,
          plan: migrationPlan,
          migrationEdges: synthEdges(migrationPlan),
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
    return operations.map((operation) => operation.id);
  }

  async function introspect(contract: Contract<SqlStorage>): Promise<SqlSchemaIRNode> {
    return familyInstance.introspect({ driver: driver!, contract });
  }

  async function expectSettled(contract: Contract<SqlStorage>): Promise<void> {
    const schema = await introspect(contract);
    const replan = plan(contract, contract, anyClass, schema);
    expect(replan.kind === 'success' ? replan.plan.operations : replan).toEqual([]);
    const verified = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect({ ok: verified.ok, issues: verified.schema.issues }).toEqual({ ok: true, issues: [] });
  }

  async function constraints() {
    const result = await driver!.query<{ table: string; name: string; definition: string }>(
      `SELECT t.relname AS "table", c.conname AS name, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname IN ('public', 'audit') AND c.contype IN ('p', 'f')
       ORDER BY t.relname, c.conname`,
    );
    return result.rows;
  }

  async function seedBlog(options: { audit: boolean } = { audit: true }): Promise<void> {
    await driver!.query(`
      INSERT INTO "public"."User" ("id", "email") VALUES (1, 'ada@example.com'), (2, 'bo@example.com');
      INSERT INTO "public"."Post" ("id", "authorId") VALUES (10, 1), (11, 2);
      INSERT INTO "public"."Comment" ("id", "postId") VALUES (100, 10), (101, 10), (102, 11);
    `);
    if (options.audit) {
      await driver!.query(`INSERT INTO "audit"."Entry" ("id", "userId") VALUES (1000, 1)`);
    }
  }

  const editedConstraints = [
    {
      table: 'Comment',
      name: 'Comment_pkey',
      definition: 'PRIMARY KEY (id)',
    },
    {
      table: 'Comment',
      name: 'Comment_postId_fkey',
      definition:
        'FOREIGN KEY ("postId") REFERENCES "Post"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
    {
      table: 'Entry',
      name: 'Entry_pkey',
      definition: 'PRIMARY KEY (id)',
    },
    {
      table: 'Entry',
      name: 'Entry_userId_fkey',
      definition:
        'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    },
    {
      table: 'Post',
      name: 'Post_author_fk',
      definition:
        'FOREIGN KEY ("authorId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    },
    { table: 'Post', name: 'Post_pkey', definition: 'PRIMARY KEY (id)' },
    { table: 'User', name: 'User_pkey', definition: 'PRIMARY KEY (id, email)' },
  ];

  it('drops the foreign keys that reference it, replaces it, and adds them back, as migration plan does', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, blog(false), INIT_ADDITIVE_POLICY);
    await seedBlog();

    const operationIds = await planAndApply(blog(false), blog(true), anyClass);

    expect(operationIds).toEqual([
      'dropConstraint.Comment.Comment_postId_fkey',
      'dropConstraint.Post.Post_author_fk',
      'dropConstraint.Entry.Entry_userId_fkey',
      'dropConstraint.User.User_pkey',
      'primaryKey.User.User_pkey',
      'index.User.User_id_key',
      'foreignKey.Comment.Comment_postId_fkey',
      'foreignKey.Post.Post_author_fk',
      'foreignKey.Entry.Entry_userId_fkey',
    ]);
    expect(await constraints()).toEqual(editedConstraints);
    await driver!.query(`DELETE FROM "public"."Post" WHERE "id" = 10`);
    const comments = await driver!.query<{ id: number }>(`SELECT "id" FROM "public"."Comment"`);
    expect(comments.rows).toEqual([{ id: 102 }]);
    await expectSettled(blog(true));
  });

  it('plans the at-a-glance change from the database, as db update does', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, blog(false, 'none'), INIT_ADDITIVE_POLICY);
    await seedBlog({ audit: false });

    const operationIds = await planAndApply(
      null,
      blog(true, 'none'),
      anyClass,
      await introspect(blog(true, 'none')),
    );

    expect(operationIds).toEqual([
      'dropConstraint.Comment.Comment_postId_fkey',
      'dropConstraint.Post.Post_author_fk',
      'dropConstraint.User.User_pkey',
      'primaryKey.User.User_pkey',
      'index.User.User_id_key',
      'foreignKey.Comment.Comment_postId_fkey',
      'foreignKey.Post.Post_author_fk',
    ]);
    expect(await constraints()).toEqual(
      editedConstraints.filter((constraint) => constraint.table !== 'Entry'),
    );
    await expectSettled(blog(true, 'none'));
  });

  it('is refused by db init, which allows only additive changes', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, blog(false, 'none'), INIT_ADDITIVE_POLICY);

    const result = plan(
      null,
      blog(true, 'none'),
      INIT_ADDITIVE_POLICY,
      await introspect(blog(true, 'none')),
    );

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'foreignKeyConflict',
          refusedOperationClass: 'widening',
          location: { constraint: 'Comment_postId_fkey' },
        },
        {
          kind: 'foreignKeyConflict',
          refusedOperationClass: 'widening',
          location: { constraint: 'Post_author_fk' },
        },
        {
          kind: 'foreignKeyConflict',
          refusedOperationClass: 'widening',
          location: { constraint: 'User_pkey' },
        },
      ],
    });
  });

  it('refuses, as db update, when a foreign key on a table the contract marks external references the key, and its db update advice works', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, blog(false, 'none'), INIT_ADDITIVE_POLICY);
    await driver!.query(`
      CREATE SCHEMA audit;
      CREATE TABLE "audit"."Entry" (
        "id" int4 PRIMARY KEY,
        "userId" int4 NOT NULL,
        CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);

    const result = plan(
      null,
      blog(true, 'external'),
      anyClass,
      await introspect(blog(true, 'external')),
    );

    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'foreignKeyConflict',
          summary:
            'Primary key "User_pkey" on "public"."User" cannot change while foreign key "Entry_userId_fkey" on "audit"."Entry" references it, and the control policy does not let this plan change "audit"."Entry".',
          why: 'With migration plan, give "audit"."Entry" a control policy that lets this plan change it and plan again, or write the change as its own migration with prisma migration new, dropping that foreign key before the key change and adding it back after it. With db update, drop that foreign key yourself and leave it out of the contract, run db update, then add the foreign key back to both if you still want it and run db update again.',
          location: { entityKind: 'table', entityName: 'Entry', constraint: 'Entry_userId_fkey' },
        },
      ],
    });
    expect(await constraints()).toContainEqual({
      table: 'Entry',
      name: 'Entry_userId_fkey',
      definition:
        'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    });

    await driver!.query(`ALTER TABLE "audit"."Entry" DROP CONSTRAINT "Entry_userId_fkey"`);
    await planAndApply(
      null,
      blog(true, 'external-unlinked'),
      anyClass,
      await introspect(blog(true, 'external-unlinked')),
    );
    await driver!.query(
      `ALTER TABLE "audit"."Entry" ADD CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
    expect(await constraints()).toEqual(editedConstraints);
    await planAndApply(
      null,
      blog(true, 'external'),
      anyClass,
      await introspect(blog(true, 'external')),
    );
    const marker = await driver!.query<{ core_hash: string }>(
      'SELECT core_hash FROM prisma_contract.marker',
    );
    expect(marker.rows).toEqual([{ core_hash: blog(true, 'external').storage.storageHash }]);
    await expectSettled(blog(true, 'external'));
  });

  it('drops the key before the column it moves off when the plan drops that column', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, tag(false), INIT_ADDITIVE_POLICY);
    await driver!.query(`INSERT INTO "public"."Tag" ("uuid", "code") VALUES (1, 'a'), (2, 'b')`);

    await planAndApply(tag(false), tag(true), anyClass);

    await expectSettled(tag(true));
    const rows = await driver!.query<{ code: string }>(`SELECT "code" FROM "public"."Tag"`);
    expect(rows.rows).toEqual([{ code: 'a' }, { code: 'b' }]);
  });

  it('drops the key before the column it moves off, from the database', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(null, tag(false), INIT_ADDITIVE_POLICY);

    await planAndApply(null, tag(true), anyClass, await introspect(tag(true)));

    await expectSettled(tag(true));
  });
});
