import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('family instance schemaVerify', () => {
  let connectionString: string | undefined;

  beforeAll(async () => {
    const database = await createDevDatabase();
    connectionString = database.connectionString;
    return async () => {
      await database.close();
    };
  }, timeouts.spinUpPpgDev);

  describe('strict mode: extra columns', () => {
    beforeEach(async () => {
      if (!connectionString) {
        throw new Error('Connection string not set');
      }
      await withClient(connectionString, async (client) => {
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
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

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
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
          const schema = await familyInstance.introspect({
            driver,
            contract: validatedContract,
          });
          const result = familyInstance.verifySchema({
            contract: validatedContract,
            schema,
            strict: true,
            frameworkComponents,
          });

          expect(result.ok).toBe(false);
          expect(result.schema.issues).toContainEqual(
            expect.objectContaining({
              path: ['database', 'public', 'user', 'column:extraColumn'],
            }),
          );
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'returns ok=true in permissive mode with extra column',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

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
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
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

          // In permissive mode, extra columns don't cause failures
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

  describe('type metadata registry', () => {
    it('registry contains known type IDs with expected native types', () => {
      const familyInstance = sql.create(
        createControlStack({
          family: sql,
          target: postgres,
          adapter: postgresAdapter,
          driver: postgresDriver,
          extensions: [],
        }),
      );

      const registry = familyInstance.typeMetadataRegistry;

      // Verify known Postgres types are present
      expect(registry.has('pg/int4@1')).toBe(true);
      const int4Metadata = registry.get('pg/int4@1');
      expect(int4Metadata?.nativeType).toBe('int4');
      expect(int4Metadata?.familyId).toBe('sql');
      expect(int4Metadata?.targetId).toBe('postgres');

      expect(registry.has('pg/text@1')).toBe(true);
      const textMetadata = registry.get('pg/text@1');
      expect(textMetadata?.nativeType).toBe('text');

      expect(registry.has('pg/timestamptz-temporal@1')).toBe(true);
      const timestamptzMetadata = registry.get('pg/timestamptz-temporal@1');
      expect(timestamptzMetadata?.nativeType).toBe('timestamptz');

      expect(registry.has('pg/bool@1')).toBe(true);
      const boolMetadata = registry.get('pg/bool@1');
      expect(boolMetadata?.nativeType).toBe('bool');
    });

    it('registry includes extension pack types', () => {
      const familyInstance = sql.create(
        createControlStack({
          family: sql,
          target: postgres,
          adapter: postgresAdapter,
          driver: postgresDriver,
          extensions: [pgvector],
        }),
      );

      const registry = familyInstance.typeMetadataRegistry;

      // Verify pgvector type is present
      expect(registry.has('pg/vector@1')).toBe(true);
      const vectorMetadata = registry.get('pg/vector@1');
      expect(vectorMetadata?.nativeType).toBe('vector');
      expect(vectorMetadata?.familyId).toBe('sql');
      expect(vectorMetadata?.targetId).toBe('postgres');
    });

    it(
      'type mismatch with metadata present returns failure',
      async () => {
        if (!connectionString) {
          throw new Error('Connection string not set');
        }

        await withClient(connectionString, async (client) => {
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
          const frameworkComponents: ReadonlyArray<
            TargetBoundComponentDescriptor<'sql', 'postgres'>
          > = [postgres, postgresAdapter];
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

          // Should fail due to type mismatch (integer vs bigint)
          expect(result.ok).toBe(false);
          expect(result.schema.issues).toContainEqual(
            expect.objectContaining({
              path: ['database', 'public', 'user', 'column:id'],
            }),
          );
        } finally {
          await driver.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
