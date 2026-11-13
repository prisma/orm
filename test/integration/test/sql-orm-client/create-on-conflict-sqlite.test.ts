import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/runtime';
import { soleDomainNamespaceId } from '@internal/contract/types';
import sqliteDriver from '@internal/driver-sqlite/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import { autoincrement, defineContract, field, model } from '@internal/sqlite/contract-builder';
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
import sqliteTarget from '@internal/target-sqlite/runtime';
import { InternalError } from '@internal/utils/internal-error';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const contract = defineContract({
  models: {
    Counter: model('Counter', {
      fields: {
        id: field.column(integerColumn).default(autoincrement()).id(),
        label: field.column(textColumn),
        slug: field.column(textColumn).optional().unique(),
      },
    }).sql({ table: 'counters' }),
  },
});

interface Harness {
  readonly counters: Collection<typeof contract, 'Counter'>;
  readonly rows: () => unknown[];
}

async function withDatabase(fn: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-create-on-conflict-'));
  const path = join(directory, 'test.db');
  const database = new DatabaseSync(path);
  database.exec(`
    create table counters (id integer primary key autoincrement, label text not null, slug text unique);
    insert into counters (label, slug) values ('existing', 'taken');
  `);
  database.close();

  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const instance = instantiateExecutionStack(stack);
  const { adapter, driver } = instance;
  if (adapter === undefined || driver === undefined) {
    throw new InternalError('SQLite execution stack is missing its adapter or driver');
  }
  await driver.connect({ kind: 'path', path });
  const runtime = new SqliteRuntimeImpl({ context, adapter, driver, closeRefusal: undefined });
  const rows = () => {
    const reader = new DatabaseSync(path);
    try {
      return reader
        .prepare('select label, slug from counters order by id')
        .all()
        .map((row) => ({ ...row }));
    } finally {
      reader.close();
    }
  };
  try {
    await fn({
      counters: new Collection({ runtime, context }, 'Counter', {
        namespaceId: soleDomainNamespaceId(contract.domain),
      }),
      rows,
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const existing = { label: 'existing', slug: 'taken' };

describe('integration/create on conflict skip on SQLite: rows that cannot conflict', () => {
  it(
    'createAll() and createAndCount() refuse a row whose only keys are auto-increment or null and write nothing',
    async () => {
      await withDatabase(async ({ counters, rows }) => {
        const data = [
          { label: 'a', slug: 'a' },
          { label: 'b', slug: null },
        ];
        const refusal = (method: string) =>
          expect.objectContaining({
            code: 'ORM.ARGUMENT_INVALID',
            message: `${method} row 1 for model "Counter" gives no value for any conflict key: (id), (slug)`,
            meta: { method, model: 'Counter', index: 1, conflictKeys: [['id'], ['slug']] },
          });

        expect(() => counters.createAll(data, { onConflict: 'skip' })).toThrow(
          refusal('createAll()'),
        );
        await expect(counters.createAndCount(data, { onConflict: 'skip' })).rejects.toThrow(
          refusal('createAndCount()'),
        );
        expect(rows()).toEqual([existing]);
      });
    },
    timeouts.databaseOperation,
  );

  it(
    'createAll() and createAndCount() accept rows that give a key and skip the colliding one',
    async () => {
      await withDatabase(async ({ counters, rows }) => {
        const inserted = await counters
          .select('label', 'slug')
          .createAll(
            [
              { label: 'clash', slug: 'taken' },
              { label: 'a', slug: 'a' },
            ],
            { onConflict: 'skip' },
          )
          .toArray();
        const count = await counters.createAndCount(
          [
            { label: 'clash again', slug: 'a' },
            { label: 'b', slug: 'b' },
          ],
          { onConflict: 'skip', conflictOn: ['slug'] },
        );

        expect({ inserted, count, rows: rows() }).toEqual({
          inserted: [{ label: 'a', slug: 'a' }],
          count: 1,
          rows: [existing, { label: 'a', slug: 'a' }, { label: 'b', slug: 'b' }],
        });
      });
    },
    timeouts.databaseOperation,
  );
});
