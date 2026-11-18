import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { pushContract } from '../push-sqlite';
import { withoutCapabilities } from '../same-on-both-paths';
import type { Contract } from './fixtures/sqlite/generated/contract';
import contractJson from './fixtures/sqlite/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

type Client = ReturnType<typeof sqlite<Contract>>;

async function withDatabase(run: (db: Client) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-known-failures-'));
  const path = join(directory, 'test.db');
  await pushContract(path, contractJson);
  try {
    await using db = sqlite({ contract, path, verifyMarker: false });
    await run(db);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withoutReturning(db: Client) {
  return orm({
    context: withoutCapabilities(db.context, ['returning']),
    runtime: db.runtime(),
  })[UNBOUND_NAMESPACE_ID];
}

describe('SQLite ORM calls known to fail', () => {
  describe('a BigInt beyond the safe integer range', () => {
    it.fails('is returned by the create that stores it', async () => {
      await withDatabase(async (db) => {
        expect(await db.orm.Counter.create({ id: 1, big: 2n ** 62n })).toEqual({
          id: 1,
          big: 2n ** 62n,
        });
      });
    });

    it.fails('is read back', async () => {
      await withDatabase(async (db) => {
        await db.orm.Counter.createAndCount([{ id: 1, big: 2n ** 62n }]);
        expect(await db.orm.Counter.select('id', 'big').all()).toEqual([{ id: 1, big: 2n ** 62n }]);
      });
    });
  });

  describe('a row another row of the same call changes', () => {
    it.fails('is returned by deleteAll the same with and without RETURNING', async () => {
      const deleted: unknown[] = [];
      for (const people of [
        (db: Client) => db.orm.Person,
        (db: Client) => withoutReturning(db).Person,
      ]) {
        await withDatabase(async (db) => {
          await db.orm.Person.createAndCount([
            { id: 1, managerId: null },
            { id: 2, managerId: 1 },
          ]);
          const rows = await people(db)
            .where((person) => person.id.in([1, 2]))
            .select('id', 'managerId')
            .deleteAll();
          deleted.push([...rows].sort((left, right) => left.id - right.id));
        });
      }
      expect(deleted[0]).toEqual(deleted[1]);
    });

    it.fails('is returned by update as the table holds it', async () => {
      await withDatabase(async (db) => {
        await db.orm.Person.createAndCount([{ id: 4, managerId: null }]);
        const updated = await db.orm.Person.whereUnique({ id: 4 })
          .select('id', 'managerId')
          .update({ id: 21, managerId: 4 });
        expect(updated).toEqual(
          await db.orm.Person.whereUnique({ id: 21 }).select('id', 'managerId').first(),
        );
      });
    });
  });
});
