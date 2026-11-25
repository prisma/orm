/**
 * Basic schema verification tests: happy path, missing table, missing column.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  rel,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - basic', () => {
  const { getConnectionString } = useDevDatabase();

  describe('happy path: schema matches contract', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            CONSTRAINT "user_email_unique" UNIQUE (email)
          )
        `);
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL,
            FOREIGN KEY ("userId") REFERENCES "user"(id)
          )
        `);
        await client.query('CREATE INDEX "post_userId_idx_a489d58a" ON "post"("userId")');
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=true with all pass nodes',
      async () => {
        const User = model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
          },
        }).sql({ table: 'user' });

        const Post = model('Post', {
          fields: {
            id: field.column(int4Column).id(),
            userId: field.column(int4Column),
            title: field.column(textColumn),
          },
          relations: {
            user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'post',
          indexes: [constraints.index([cols.userId])],
        }));

        const contract = defineContract({
          version: 18,
          models: {
            User: User.relations({
              posts: rel.hasMany(Post, { by: 'userId' }),
            }),
            Post,
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result).toMatchObject({
          ok: true,
          schema: { issues: [] },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing table', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "post"');
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with a not-found issue for the missing table',
      async () => {
        const contract = defineContract({
          version: 18,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
            Post: model('Post', {
              fields: {
                id: field.column(int4Column).id(),
                title: field.column(textColumn),
              },
            }).sql({ table: 'post' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({ path: ['database', 'public', 'post'] }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('missing column', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with a not-found issue for the missing column',
      async () => {
        const contract = defineContract({
          version: 18,
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql({ table: 'user' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'column:email'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
