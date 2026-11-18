import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { describe, it } from 'vitest';
import { exercisedByEverySuite, exercisedWithManySequences, onEachSchema } from './each-schema';
import { pushContract } from './push-sqlite';
import type { LooseOrm } from './run-on-orm';
import { expectExercised, sameOnBothPaths, Tally, withoutCapabilities } from './same-on-both-paths';
import { scalarTypeNames } from './schemas';

describe('SQLite ORM calls with and without a capability', { timeout: 900_000 }, () => {
  it('return the same values and store the same rows, on generated schemas', async () => {
    const tally = new Tally();
    await onEachSchema('sqlite', 16, async ({ schema, contractJson, seed }) => {
      const directory = mkdtempSync(join(tmpdir(), 'orm-capability-paths-'));
      const path = join(directory, 'test.db');
      await pushContract(path, contractJson);
      const unchecked = new DatabaseSync(path, { enableForeignKeyConstraints: false });
      const emptied = [
        ...schema.tables.map((table) => `delete from "${table}";`),
        "delete from sqlite_sequence where exists (select 1 from sqlite_master where name = 'sqlite_sequence');",
      ];
      try {
        await using db = sqlite({
          contract: contractFromJson<Contract<SqlStorage>>(contractJson),
          path,
          verifyMarker: false,
        });
        await sameOnBothPaths(
          {
            reference: db.orm as unknown as LooseOrm,
            varied: (removed) =>
              orm({ context: withoutCapabilities(db.context, removed), runtime: db.runtime() })[
                '__unbound__'
              ] as unknown as LooseOrm,
            clear: () => {
              for (const statement of emptied) {
                try {
                  unchecked.exec(statement);
                } catch (error) {
                  if (!String(error).includes('no such table: sqlite_sequence')) throw error;
                }
              }
            },
          },
          { schema, runs: 30, seed, generatedKeys: true, tally },
        );
      } finally {
        unchecked.close();
        rmSync(directory, { recursive: true, force: true });
      }
    });
    expectExercised(tally, [
      ...scalarTypeNames('sqlite').map((name) => `stored ${name}`),
      ...exercisedByEverySuite,
      ...exercisedWithManySequences,
      'create depth 3',
      'create on generated key',
    ]);
  });
});
