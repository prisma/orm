/**
 * Constraint verification tests: primary key, foreign key, unique.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  postgres18,
  postgresDriver,
  rel,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - constraints', () => {
  const { getConnectionString } = useDevDatabase();

  describe('primary key mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL,
            email TEXT NOT NULL,
            PRIMARY KEY (email)
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with a not-equal issue for the primary key',
      async () => {
        const contract = defineContract({
          requiredCapabilities: [...postgres18, ...postgresDriver],
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
            path: ['database', 'public', 'user', 'primary-key'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('unique constraint mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
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
      'returns ok=false with a not-found issue for the missing unique constraint',
      async () => {
        const contract = defineContract({
          requiredCapabilities: [...postgres18, ...postgresDriver],
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn).unique(),
              },
            }).sql({ table: 'user' }),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'unique:email'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('foreign key mismatch', () => {
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
        await client.query(`
          CREATE TABLE "post" (
            id SERIAL PRIMARY KEY,
            "userId" INTEGER NOT NULL,
            title TEXT NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with a not-found issue for the missing foreign key',
      async () => {
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
          relations: {
            user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
          },
        }).sql({ table: 'post' });

        const contract = defineContract({
          requiredCapabilities: [...postgres18, ...postgresDriver],
          models: {
            User: User.relations({
              posts: rel.hasMany(Post, { by: 'userId' }),
            }),
            Post,
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'post', 'foreign-key:userId->public.user(id)'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
