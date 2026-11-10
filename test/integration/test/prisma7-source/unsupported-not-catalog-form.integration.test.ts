/**
 * Prisma 7 writes an `Unsupported("...")` text into DDL as given, and Postgres stores the type
 * under its catalog name. The Prisma 7 source reads the text as written, so `db verify` reports a
 * text that is not in catalog form with the text the database reports (ADR 273).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { withClient } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify, timeouts, useDevDatabase } from '../family.schema-verify.helpers';
import { loadPrisma7Schema } from './load-prisma7-schema';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prisma7-source/unsupported-not-catalog-form',
);

describe('an Unsupported text not in catalog form', () => {
  const { getConnectionString } = useDevDatabase();

  it(
    'loads, and db verify reports the text the database reports',
    async () => {
      await withClient(getConnectionString(), async (client) => {
        await client.query('DROP TABLE IF EXISTS "Legacy"');
        await client.query(readFileSync(join(fixtureDir, 'migration.sql'), 'utf8'));
      });
      const contract = await loadPrisma7Schema(join(fixtureDir, 'schema.prisma'));

      const verified = await runSchemaVerify(
        getConnectionString(),
        new PostgresContractSerializer().serializeContract(contract),
      );

      expect(
        verified.schema.issues.map((issue) => ({
          path: issue.path,
          explanation: issue.explanation?.text,
        })),
      ).toEqual([
        {
          path: ['database', 'public', 'Legacy', 'column:code'],
          explanation:
            'The column type is "INT4", but the database reports "integer". A type named by its catalog text is compared with the text the database reports, exactly.',
        },
        {
          path: ['database', 'public', 'Legacy', 'column:name'],
          explanation:
            'The column type is "varchar(10)", but the database reports "character varying(10)". A type named by its catalog text is compared with the text the database reports, exactly.',
        },
      ]);
    },
    timeouts.spinUpPpgDev,
  );
});
