import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { type Paths, withoutCapabilities } from './paths';
import { pushContract } from './push-sqlite';
import type { LooseOrm } from './run-on-orm';

export async function withSqliteDatabase(
  contractJson: unknown,
  tables: readonly string[],
  run: (paths: Paths) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-properties-'));
  const path = join(directory, 'test.db');
  await pushContract(path, contractJson);
  const unchecked = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  const hasSequences =
    unchecked.prepare("select 1 from sqlite_master where name = 'sqlite_sequence'").get() !==
    undefined;
  const emptied = [
    ...tables.map((table) => `delete from "${table}";`),
    ...(hasSequences ? ['delete from sqlite_sequence;'] : []),
  ].join('\n');
  try {
    await using db = sqlite({
      contract: contractFromJson<Contract<SqlStorage>>(contractJson),
      path,
      verifyMarker: false,
    });
    await run({
      reference: db.orm as unknown as LooseOrm,
      varied: (removed) =>
        orm({ context: withoutCapabilities(db.context, removed), runtime: db.runtime() })[
          '__unbound__'
        ] as unknown as LooseOrm,
      clear: () => unchecked.exec(emptied),
    });
  } finally {
    unchecked.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
