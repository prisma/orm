import type { Contract } from '@internal/contract/types';
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import { withClient, withDevDatabase } from '@repo/test-utils';
import { describe, it } from 'vitest';
import { pushContract } from '../_harness/postgres';
import { exercisedByEverySuite, onEachSchema } from './each-schema';
import type { LooseOrm } from './run-on-orm';
import { expectExercised, sameOnBothPaths, Tally, withoutCapabilities } from './same-on-both-paths';

function statement(text: string): TemplateStringsArray {
  return Object.assign([text], { raw: [text] });
}

const emptyDatabase = `
  drop schema if exists public cascade;
  drop schema if exists prisma_contract cascade;
  create schema public;
`;

describe('Postgres ORM calls with and without a capability', { timeout: 900_000 }, () => {
  it('return the same values and store the same rows, on generated schemas', async () => {
    const tally = new Tally();
    await withDevDatabase(async ({ connectionString }) => {
      await onEachSchema('postgres', 8, async ({ schema, contractJson, seed }) => {
        await withClient(connectionString, (client) => client.query(emptyDatabase));
        await pushContract(connectionString, contractJson);
        const tables = schema.tables.map((table) => `"${table}"`).join(', ');
        await using db = postgres({
          contract: contractFromJson<Contract<SqlStorage>>(contractJson),
          url: connectionString,
          verifyMarker: false,
        });
        await sameOnBothPaths(
          {
            reference: db.orm['public'] as unknown as LooseOrm,
            varied: (removed) =>
              orm({ context: withoutCapabilities(db.context, removed), runtime: db.runtime() })[
                'public'
              ] as unknown as LooseOrm,
            clear: async () => {
              await db.execute(
                db.raw
                  .sql(statement(`truncate table ${tables} restart identity`))
                  .affectedCount()
                  .build(),
              );
            },
          },
          { schema, runs: 12, seed, generatedKeys: false, tally },
        );
      });
    });
    expectExercised(tally, exercisedByEverySuite);
  });
});
