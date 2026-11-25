/**
 * Verification mode tests: strict mode.
 */
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('family instance schemaVerify - modes', () => {
  const { getConnectionString } = useDevDatabase();

  describe('strict mode: extra columns', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            "extraColumn" TEXT
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false in strict mode with a not-expected issue for the extra column',
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

        const result = await runSchemaVerify(getConnectionString(), contract, { strict: true });

        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'column:extraColumn'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns ok=true in permissive mode with extra column',
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

        const result = await runSchemaVerify(getConnectionString(), contract, { strict: false });

        // In permissive mode, extra columns don't cause failures
        expect(result).toMatchObject({
          ok: true,
          schema: { issues: [] },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
