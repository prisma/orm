import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import type { Client } from 'pg';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>> = [
  postgres,
  postgresAdapter,
];

describe('referential actions integration', () => {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  describe('introspection', () => {
    beforeEach(async () => {
      if (!connectionString) throw new Error('Connection string not set');

      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "comment"');
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');

        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE RESTRICT
          )
        `);
        await client.query(`
          CREATE TABLE "comment" (
            id SERIAL PRIMARY KEY,
            "postId" INTEGER,
            body TEXT NOT NULL,
            FOREIGN KEY ("postId") REFERENCES "post"(id) ON DELETE SET NULL ON UPDATE CASCADE
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'introspects ON DELETE CASCADE and ON UPDATE RESTRICT',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const schemaIR = await familyInstance.introspect({ driver });
          PostgresDatabaseSchemaNode.assert(schemaIR);
          const ns = schemaIR.namespaces['public']!;

          const postTable = ns.tables['post'];
          expect(postTable).toBeDefined();
          expect(postTable?.foreignKeys).toHaveLength(1);

          const fk = postTable!.foreignKeys[0]!;
          expect(fk.columns).toEqual(['userId']);
          expect(fk.referencedTable).toBe('user');
          expect(fk.onDelete).toBe('cascade');
          expect(fk.onUpdate).toBe('restrict');
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );

    it(
      'introspects ON DELETE SET NULL and ON UPDATE CASCADE',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const schemaIR = await familyInstance.introspect({ driver });
          PostgresDatabaseSchemaNode.assert(schemaIR);
          const ns = schemaIR.namespaces['public']!;

          const commentTable = ns.tables['comment'];
          expect(commentTable).toBeDefined();
          expect(commentTable?.foreignKeys).toHaveLength(1);

          const fk = commentTable!.foreignKeys[0]!;
          expect(fk.columns).toEqual(['postId']);
          expect(fk.referencedTable).toBe('post');
          expect(fk.onDelete).toBe('setNull');
          expect(fk.onUpdate).toBe('cascade');
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );

    it(
      'omits NO ACTION (the default) from introspection result',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "comment"');
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');
          await client.query(`CREATE TABLE "user" (id SERIAL PRIMARY KEY)`);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
            )
          `);
        });

        const driver = await postgresDriver.create(connectionString);
        try {
          const familyInstance = sql.create(
            createControlStack({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            }),
          );

          const schemaIR = await familyInstance.introspect({ driver });
          PostgresDatabaseSchemaNode.assert(schemaIR);
          const ns = schemaIR.namespaces['public']!;

          const fk = ns.tables['post']?.foreignKeys[0];
          expect(fk).toBeDefined();
          expect(fk!.onDelete).toBeUndefined();
          expect(fk!.onUpdate).toBeUndefined();
        } finally {
          await driver.close();
        }
      },
      timeouts.databaseOperation,
    );
  });

  describe('schema verification', () => {
    describe('matching referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE RESTRICT
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx_a489d58a" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=true when contract and DB referential actions match',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const User = model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql({ table: 'user' });

          const Post = model('Post', {
            fields: {
              id: field.column(int4Column).id(),
              userId: field.column(int4Column),
              title: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'post',
            indexes: [constraints.index([cols.userId])],
            foreignKeys: [
              constraints.foreignKey(cols.userId, User.refs.id, {
                onDelete: 'cascade',
                onUpdate: 'restrict',
              }),
            ],
          }));

          const contract = defineContract({
            foreignKeyDefaults: { constraint: true, index: true },
            models: { User, Post },
          });

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create(
              createControlStack({
                family: sql,
                target: postgres,
                adapter: postgresAdapter,
                driver: postgresDriver,
                extensions: [],
              }),
            );

            const validatedContract = new PostgresContractSerializer().deserializeContract(
              contract,
            ) as Contract<SqlStorage>;
            const schema = await familyInstance.introspect({
              driver,
              contract: validatedContract,
            });
            const result = familyInstance.verifySchema({
              contract: validatedContract,
              schema,
              strict: false,
              frameworkComponents,
            });

            expect(result).toMatchObject({
              ok: true,
              schema: { issues: [] },
            });
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('mismatched referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE SET NULL ON UPDATE CASCADE
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx_a489d58a" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=false when onDelete mismatches',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const User = model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql({ table: 'user' });

          const Post = model('Post', {
            fields: {
              id: field.column(int4Column).id(),
              userId: field.column(int4Column),
              title: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'post',
            indexes: [constraints.index([cols.userId])],
            foreignKeys: [
              constraints.foreignKey(cols.userId, User.refs.id, {
                onDelete: 'cascade',
                onUpdate: 'cascade',
              }),
            ],
          }));

          const contract = defineContract({
            foreignKeyDefaults: { constraint: true, index: true },
            models: { User, Post },
          });

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create(
              createControlStack({
                family: sql,
                target: postgres,
                adapter: postgresAdapter,
                driver: postgresDriver,
                extensions: [],
              }),
            );

            const validatedContract = new PostgresContractSerializer().deserializeContract(
              contract,
            ) as Contract<SqlStorage>;
            const schema = await familyInstance.introspect({
              driver,
              contract: validatedContract,
            });
            const result = familyInstance.verifySchema({
              contract: validatedContract,
              schema,
              strict: false,
              frameworkComponents,
            });

            expect(result.ok).toBe(false);
            expect(result.schema.issues).toContainEqual(
              expect.objectContaining({
                path: ['database', 'public', 'post', 'foreign-key:userId->public.user(id)'],
              }),
            );
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'returns ok=false when onUpdate mismatches',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const User = model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql({ table: 'user' });

          const Post = model('Post', {
            fields: {
              id: field.column(int4Column).id(),
              userId: field.column(int4Column),
              title: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'post',
            indexes: [constraints.index([cols.userId])],
            foreignKeys: [
              constraints.foreignKey(cols.userId, User.refs.id, {
                onDelete: 'cascade',
                onUpdate: 'restrict',
              }),
            ],
          }));

          const contract = defineContract({
            foreignKeyDefaults: { constraint: true, index: true },
            models: { User, Post },
          });

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create(
              createControlStack({
                family: sql,
                target: postgres,
                adapter: postgresAdapter,
                driver: postgresDriver,
                extensions: [],
              }),
            );

            const validatedContract = new PostgresContractSerializer().deserializeContract(
              contract,
            ) as Contract<SqlStorage>;
            const schema = await familyInstance.introspect({
              driver,
              contract: validatedContract,
            });
            const result = familyInstance.verifySchema({
              contract: validatedContract,
              schema,
              strict: false,
              frameworkComponents,
            });

            expect(result.ok).toBe(false);
            expect(result.schema.issues).toContainEqual(
              expect.objectContaining({
                path: ['database', 'public', 'post', 'foreign-key:userId->public.user(id)'],
              }),
            );
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract without referential actions', () => {
      beforeEach(async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "post"');
          await client.query('DROP TABLE IF EXISTS "user"');

          await client.query(`
            CREATE TABLE "user" (
              id SERIAL PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "post" (
              id SERIAL PRIMARY KEY,
              "userId" INTEGER NOT NULL,
              title TEXT NOT NULL,
              FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
            )
          `);
          await client.query('CREATE INDEX "post_userId_idx_a489d58a" ON "post"("userId")');
        });
      }, timeouts.spinUpPpgDev);

      it(
        'returns ok=true when contract omits referential actions (no comparison)',
        async () => {
          if (!connectionString) throw new Error('Connection string not set');

          const User = model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql({ table: 'user' });

          const Post = model('Post', {
            fields: {
              id: field.column(int4Column).id(),
              userId: field.column(int4Column),
              title: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'post',
            indexes: [constraints.index([cols.userId])],
            foreignKeys: [constraints.foreignKey(cols.userId, User.refs.id)],
          }));

          const contract = defineContract({
            foreignKeyDefaults: { constraint: true, index: true },
            models: { User, Post },
          });

          const driver = await postgresDriver.create(connectionString);
          try {
            const familyInstance = sql.create(
              createControlStack({
                family: sql,
                target: postgres,
                adapter: postgresAdapter,
                driver: postgresDriver,
                extensions: [],
              }),
            );

            const validatedContract = new PostgresContractSerializer().deserializeContract(
              contract,
            ) as Contract<SqlStorage>;
            const schema = await familyInstance.introspect({
              driver,
              contract: validatedContract,
            });
            const result = familyInstance.verifySchema({
              contract: validatedContract,
              schema,
              strict: false,
              frameworkComponents,
            });

            expect(result).toMatchObject({
              ok: true,
              schema: { issues: [] },
            });
          } finally {
            await driver.close();
          }
        },
        timeouts.spinUpPpgDev,
      );
    });
  });

  describe('DDL generation via planner', () => {
    beforeEach(async () => {
      if (!connectionString) throw new Error('Connection string not set');

      await withClient(connectionString, async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
      });
    }, timeouts.spinUpPpgDev);

    it(
      'planned DDL contains ON DELETE and ON UPDATE clauses for contract with referential actions',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        const User = model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql({ table: 'user' });

        const Post = model('Post', {
          fields: {
            id: field.column(int4Column).id(),
            userId: field.column(int4Column),
            title: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'post',
          indexes: [constraints.index([cols.userId])],
          foreignKeys: [
            constraints.foreignKey(cols.userId, User.refs.id, {
              onDelete: 'cascade',
              onUpdate: 'restrict',
            }),
          ],
        }));

        const contract = defineContract({
          foreignKeyDefaults: { constraint: true, index: true },
          models: { User, Post },
        });

        const validatedContract = new PostgresContractSerializer().deserializeContract(
          contract,
        ) as Contract<SqlStorage>;
        const controlStack = createControlStack({
          family: sql,
          target: postgres,
          adapter: postgresAdapter,
          driver: postgresDriver,
          extensions: [],
        });
        const familyInstance = sql.create(controlStack);

        // Introspect the empty database to get a baseline schema IR
        const driver = await postgresDriver.create(connectionString);
        try {
          const schemaIR = await familyInstance.introspect({ driver });

          // Plan migrations using the target's SQL-specific planner (contract → DDL)
          const planner = postgres.createPlanner(postgresAdapter.create(controlStack));
          const planResult = planner.plan({
            contract: validatedContract,
            schema: schemaIR,
            policy: INIT_ADDITIVE_POLICY,
            fromContract: null,
            origin: null,
            statements: [],
            frameworkComponents,
            spaceId: APP_SPACE_ID,
            snapshotsImportPath: '../../snapshots',
          });

          expect(planResult.kind).toBe('success');
          if (planResult.kind !== 'success') throw new Error('Expected planning success');

          const planOps = (await Promise.all(planResult.plan.operations)) as ReadonlyArray<{
            readonly id: string;
            readonly execute: ReadonlyArray<{ readonly sql: string }>;
          }>;
          const fkOps = planOps.filter((op) => op.id.startsWith('foreignKey.'));
          expect(fkOps.length).toBeGreaterThan(0);

          const fkSql = fkOps.flatMap((op) => op.execute.map((step) => step.sql)).join('\n');
          expect(fkSql).toContain('ON DELETE CASCADE');
          expect(fkSql).toContain('ON UPDATE RESTRICT');
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('runtime behavior', () => {
    /**
     * Helper: sets up parent/child tables with a specific ON DELETE action,
     * seeds data, deletes the parent, and returns the result.
     */
    async function setupAndDeleteParent(
      client: Client,
      onDeleteAction: string,
      options?: { childColumnNullable?: boolean; childColumnDefault?: number },
    ): Promise<{
      deleteError: Error | null;
      childRows: Array<{ id: number; parent_id: number | null }>;
    }> {
      const nullable = options?.childColumnNullable ?? false;
      const defaultClause =
        options?.childColumnDefault !== undefined ? ` DEFAULT ${options.childColumnDefault}` : '';
      const nullableClause = nullable ? '' : ' NOT NULL';

      await client.query('DROP TABLE IF EXISTS "child"');
      await client.query('DROP TABLE IF EXISTS "parent"');

      await client.query(`
        CREATE TABLE "parent" (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);
      await client.query(`
        CREATE TABLE "child" (
          id SERIAL PRIMARY KEY,
          parent_id INTEGER${nullableClause}${defaultClause},
          FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON DELETE ${onDeleteAction}
        )
      `);

      await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
      await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

      let deleteError: Error | null = null;
      try {
        await client.query(`DELETE FROM "parent" WHERE id = 1`);
      } catch (error) {
        deleteError = error as Error;
      }

      const childResult = await client.query<{ id: number; parent_id: number | null }>(
        `SELECT id, parent_id FROM "child" ORDER BY id`,
      );

      return { deleteError, childRows: childResult.rows };
    }

    it(
      'ON DELETE CASCADE removes child rows when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'CASCADE');

          expect(deleteError).toBeNull();
          expect(childRows).toHaveLength(0);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE RESTRICT blocks parent deletion when children exist',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'RESTRICT');

          expect(deleteError).not.toBeNull();
          expect(deleteError!.message).toContain('violates foreign key constraint');
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBe(1);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE SET NULL sets child FK to NULL when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'SET NULL', {
            childColumnNullable: true,
          });

          expect(deleteError).toBeNull();
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBeNull();
          expect(childRows[1]!.parent_id).toBeNull();
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE SET DEFAULT sets child FK to default value when parent is deleted',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          // Create a second parent to hold the default FK reference
          await client.query('DROP TABLE IF EXISTS "child"');
          await client.query('DROP TABLE IF EXISTS "parent"');

          await client.query(`
            CREATE TABLE "parent" (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL
            )
          `);
          // Insert the default-target parent first
          await client.query(`INSERT INTO "parent" (id, name) VALUES (99, 'default-parent')`);

          await client.query(`
            CREATE TABLE "child" (
              id SERIAL PRIMARY KEY,
              parent_id INTEGER NOT NULL DEFAULT 99,
              FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON DELETE SET DEFAULT
            )
          `);

          // Insert the parent to be deleted and its children
          await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
          await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

          // Delete the parent — children should have parent_id set to 99
          await client.query(`DELETE FROM "parent" WHERE id = 1`);

          const childResult = await client.query<{ id: number; parent_id: number }>(
            `SELECT id, parent_id FROM "child" ORDER BY id`,
          );
          expect(childResult.rows).toHaveLength(2);
          expect(childResult.rows[0]!.parent_id).toBe(99);
          expect(childResult.rows[1]!.parent_id).toBe(99);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON DELETE NO ACTION blocks parent deletion when children exist (deferred check)',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          const { deleteError, childRows } = await setupAndDeleteParent(client, 'NO ACTION');

          expect(deleteError).not.toBeNull();
          expect(deleteError!.message).toContain('violates foreign key constraint');
          expect(childRows).toHaveLength(2);
          expect(childRows[0]!.parent_id).toBe(1);
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'ON UPDATE CASCADE propagates parent primary key changes to children',
      async () => {
        if (!connectionString) throw new Error('Connection string not set');

        await withClient(connectionString, async (client) => {
          await client.query('DROP TABLE IF EXISTS "child"');
          await client.query('DROP TABLE IF EXISTS "parent"');

          await client.query(`
            CREATE TABLE "parent" (
              id INTEGER PRIMARY KEY,
              name TEXT NOT NULL
            )
          `);
          await client.query(`
            CREATE TABLE "child" (
              id SERIAL PRIMARY KEY,
              parent_id INTEGER NOT NULL,
              FOREIGN KEY ("parent_id") REFERENCES "parent"(id) ON UPDATE CASCADE
            )
          `);

          await client.query(`INSERT INTO "parent" (id, name) VALUES (1, 'parent-1')`);
          await client.query(`INSERT INTO "child" (id, parent_id) VALUES (1, 1), (2, 1)`);

          // Update parent's PK — children should cascade
          await client.query(`UPDATE "parent" SET id = 100 WHERE id = 1`);

          const childResult = await client.query<{ id: number; parent_id: number }>(
            `SELECT id, parent_id FROM "child" ORDER BY id`,
          );
          expect(childResult.rows).toHaveLength(2);
          expect(childResult.rows[0]!.parent_id).toBe(100);
          expect(childResult.rows[1]!.parent_id).toBe(100);
        });
      },
      timeouts.databaseOperation,
    );
  });
});
