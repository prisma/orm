import type { Contract } from '@internal/contract/types';
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import { withClient, withDevDatabase } from '@repo/test-utils';
import { pushContract } from '../_harness/postgres';
import { type Paths, withoutCapabilities } from './paths';
import type { LooseOrm } from './run-on-orm';

function statement(text: string): TemplateStringsArray {
  return Object.assign([text], { raw: [text] });
}

const emptyDatabase = `
  drop schema if exists public cascade;
  drop schema if exists prisma_contract cascade;
  create schema public;
`;

export type WithPostgresDatabase = (
  contractJson: unknown,
  tables: readonly string[],
  run: (paths: Paths) => Promise<void>,
) => Promise<void>;

export async function withPostgresServer(
  run: (withDatabase: WithPostgresDatabase) => Promise<void>,
): Promise<void> {
  await withDevDatabase(async ({ connectionString }) => {
    await run(async (contractJson, tables, onDatabase) => {
      await withClient(connectionString, (client) => client.query(emptyDatabase));
      await pushContract(connectionString, contractJson);
      const truncated = `truncate table ${tables.map((table) => `"${table}"`).join(', ')} restart identity`;
      await using db = postgres({
        contract: contractFromJson<Contract<SqlStorage>>(contractJson),
        url: connectionString,
        verifyMarker: false,
      });
      await onDatabase({
        reference: db.orm['public'] as unknown as LooseOrm,
        varied: (removed) =>
          orm({ context: withoutCapabilities(db.context, removed), runtime: db.runtime() })[
            'public'
          ] as unknown as LooseOrm,
        clear: async () => {
          await db.execute(db.raw.sql(statement(truncated)).affectedCount().build());
        },
      });
    });
  });
}
