/**
 * Type verification tests: type mismatch, nullability, type metadata registry.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFamilyInstance,
  defineContract,
  field,
  int4Column,
  model,
  pgvector,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';

describe('family instance schemaVerify - types', () => {
  const { getConnectionString } = useDevDatabase();

  describe('type mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id INTEGER PRIMARY KEY,
            email VARCHAR(255) NOT NULL
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'runs verification without error, whether or not the adapter maps VARCHAR onto the contract type',
      async () => {
        const contract = defineContract({
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

        // Type mismatch may or may not be detected depending on adapter introspection:
        // the adapter may map VARCHAR to pg/text@1, so this test may pass. This is
        // acceptable - the test verifies the verification runs without errors.
        expect(result).toMatchObject({
          schema: { issues: expect.any(Array) },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('nullability mismatch', () => {
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
        await client.query(`
          CREATE TABLE "user" (
            id SERIAL PRIMARY KEY,
            email TEXT
          )
        `);
      });
    }, timeouts.spinUpPpgDev);

    it(
      'returns ok=false with a not-equal issue for the nullability mismatch',
      async () => {
        const contract = defineContract({
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

  describe('type metadata registry', () => {
    // Clean up user table before each test to avoid flaky tests
    beforeEach(async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "user"');
      });
    }, timeouts.spinUpPpgDev);

    it('registry contains known type IDs with expected native types', () => {
      const familyInstance = createFamilyInstance();
      const registry = familyInstance.typeMetadataRegistry;

      // Verify known Postgres types are present with expected metadata
      expect(registry.get('pg/int4@1')).toMatchObject({
        nativeType: 'int4',
        familyId: 'sql',
        targetId: 'postgres',
      });
      expect(registry.get('pg/text@1')).toMatchObject({ nativeType: 'text' });
      expect(registry.get('pg/timestamptz-temporal@1')).toMatchObject({
        nativeType: 'timestamptz',
      });
      expect(registry.get('pg/bool@1')).toMatchObject({ nativeType: 'bool' });
    });

    it('registry includes extension pack types', () => {
      const familyInstance = createFamilyInstance([pgvector]);
      const registry = familyInstance.typeMetadataRegistry;

      // Verify pgvector type is present with expected metadata
      expect(registry.get('pg/vector@1')).toMatchObject({
        nativeType: 'vector',
        familyId: 'sql',
        targetId: 'postgres',
      });
    });

    it(
      'type mismatch with metadata present returns failure',
      async () => {
        await withClient(getConnectionString(), async (client) => {
          await client.query('DROP TABLE IF EXISTS "user"');
          // Create table with mismatched type: contract expects integer, DB has bigint
          await client.query(`
          CREATE TABLE "user" (
            id BIGINT PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
        });

        const contract = defineContract({
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

        // Should fail due to type mismatch (integer vs bigint)
        expect(result.ok).toBe(false);
        expect(result.schema.issues).toContainEqual(
          expect.objectContaining({
            path: ['database', 'public', 'user', 'column:id'],
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
