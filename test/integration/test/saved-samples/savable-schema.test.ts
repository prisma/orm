/**
 * The generator saves only what `tables.json` records of Prisma's tables on PostgreSQL, so it refuses tables holding anything more.
 */

import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { assertPostgresSchemaSavable } from './sample-projects';

describe('assertPostgresSchemaSavable', () => {
  it(
    'accepts columns, a primary key and a serial sequence, and refuses an extra index',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          await client.query('CREATE SCHEMA prisma_contract');
          await client.query(
            'CREATE TABLE prisma_contract.ledger (id serial PRIMARY KEY, space text NOT NULL, name text)',
          );
        });
        await expect(assertPostgresSchemaSavable(connectionString)).resolves.toBeUndefined();

        await withClient(connectionString, (client) =>
          client.query('CREATE INDEX ledger_space_idx ON prisma_contract.ledger (space)'),
        );
        await expect(assertPostgresSchemaSavable(connectionString)).rejects.toThrow(
          "Prisma's schema prisma_contract holds what tables.json does not record: index ledger_space_idx on ledger. The generator must learn to save and restore these before it writes this set.",
        );
      });
    },
    timeouts.spinUpPpgDev,
  );
});
