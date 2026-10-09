/**
 * Index drift scenarios against a live database.
 *
 * Documented degradation of `map:` with a SQL body: drift
 * detection byte-compares the authored text against Postgres's reprinted
 * form, so an exact-named expression index reports drift even when the live
 * object was created from exactly the authored text (Postgres reprints
 * `lower(email || 'x')` as `lower((email || 'x'::text))`). The authoring-time
 * warning half of this behavior is pinned in
 * packages/2-sql/1-core/contract/test/index-naming.test.ts.
 *
 * An out-of-band `ALTER INDEX … SET (fillfactor = 70)` on a
 * wire-named index is real drift: the live options bag no longer matches the
 * contract and verify reports the index not-equal.
 */

import { sql } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('index drift', () => {
  const { getConnectionString } = useDevDatabase();

  describe('map: with a SQL body byte-compares against the reprint', () => {
    it(
      'reports drift for an exact-named expression index created from the authored text',
      async () => {
        await withClient(getConnectionString(), async (client) => {
          await client.query('DROP TABLE IF EXISTS "user"');
          await client.query(`
            CREATE TABLE "user" (
              id INTEGER PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query(
            `CREATE INDEX "user_email_expr_exact" ON "user" (lower(email || 'x'))`,
          );
        });

        const contract = defineContract({
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql(({ constraints }) => ({
              table: 'user',
              indexes: [
                constraints.index({
                  expression: sql`lower(email || 'x')`,
                  map: 'user_email_expr_exact',
                }),
              ],
            })),
          },
        });

        const result = await runSchemaVerify(getConnectionString(), contract);

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'index:user_email_expr_exact'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe("authored type: 'btree' is the default access method, not drift", () => {
    it(
      'verifies clean against a live index created with the default method',
      async () => {
        await withClient(getConnectionString(), async (client) => {
          await client.query('DROP TABLE IF EXISTS "user"');
          await client.query(`
          CREATE TABLE "user" (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
          await client.query('CREATE INDEX "user_email_btree_73653512" ON "user" ("email")');
        });

        const contract = defineContract({}, ({ field: packField, model: packModel }) => ({
          models: {
            User: packModel('User', {
              fields: {
                id: packField.column(int4Column).id(),
                email: packField.column(textColumn),
              },
            }).sql(({ cols, constraints }) => ({
              table: 'user',
              indexes: [
                constraints.index([cols.email], {
                  name: 'user_email_btree',
                  type: 'btree',
                  options: {},
                }),
              ],
            })),
          },
        }));

        const result = await runSchemaVerify(getConnectionString(), contract);
        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('out-of-band storage-parameter change on a wire-named index', () => {
    it(
      'verifies clean before the ALTER and reports the index not-equal after it',
      async () => {
        await withClient(getConnectionString(), async (client) => {
          await client.query('DROP TABLE IF EXISTS "user"');
          await client.query(`
            CREATE TABLE "user" (
              id INTEGER PRIMARY KEY,
              email TEXT NOT NULL
            )
          `);
          await client.query('CREATE INDEX "user_email_idx_46df9cad" ON "user" ("email")');
        });

        const contract = defineContract({
          models: {
            User: model('User', {
              fields: {
                id: field.column(int4Column).id(),
                email: field.column(textColumn),
              },
            }).sql(({ cols, constraints }) => ({
              table: 'user',
              indexes: [constraints.index([cols.email], { name: 'user_email_idx' })],
            })),
          },
        });

        const clean = await runSchemaVerify(getConnectionString(), contract);
        expect(clean.ok).toBe(true);

        await withClient(getConnectionString(), (client) =>
          client.query('ALTER INDEX "user_email_idx_46df9cad" SET (fillfactor = 70)'),
        );

        const drifted = await runSchemaVerify(getConnectionString(), contract);
        expect(drifted.ok).toBe(false);
        expect(drifted.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'index:user_email_idx_46df9cad'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
