import type { MysqlTransactionContext } from '@internal/mysql/runtime';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { LiveContract } from '#live-types';
import { exampleDatabase, withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

type Tx = MysqlTransactionContext<LiveContract>;

const create = (tx: Tx, id: number, email: string) =>
  tx.orm.User.select('id').create({ id, email, role: 'USER' });

const emails = async (q: Pick<Tx, 'orm'>) =>
  (
    await q.orm.User.select('email')
      .where((user) => user.id.gte(10))
      .orderBy((user) => user.id.asc())
      .all()
  ).map((user) => user.email);

export function describeNestedTransactions(server: LiveServer): void {
  describe(`tx.transaction on ${server.displayName}`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('passes the facade context to the nested callback and commits the work around the nested transaction that threw', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false, poolOptions: { max: 1 } });
        let inside: string[] = [];
        await db.transaction(async (tx) => {
          await create(tx, 10, 'a@nested.example');
          await tx
            .transaction(async (inner) => {
              await create(inner, 11, 'b@nested.example');
              inside = await emails(inner);
              throw new Error('nope');
            })
            .catch(() => undefined);
          await create(tx, 12, 'c@nested.example');
        });

        expect({ inside, committed: await emails(db) }).toEqual({
          inside: ['a@nested.example', 'b@nested.example'],
          committed: ['a@nested.example', 'c@nested.example'],
        });
      });
    });

    it('rolls back the innermost of three nested transactions and commits the middle and outer ones', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false, poolOptions: { max: 1 } });
        let inside: string[] = [];
        await db.transaction(async (tx) => {
          await create(tx, 10, 'a@nested.example');
          await tx.transaction(async (middle) => {
            await create(middle, 11, 'b@nested.example');
            await middle
              .transaction(async (inner) => {
                await create(inner, 12, 'c@nested.example');
                inside = await emails(inner);
                throw new Error('nope');
              })
              .catch(() => undefined);
          });
        });

        expect({ inside, committed: await emails(db) }).toEqual({
          inside: ['a@nested.example', 'b@nested.example', 'c@nested.example'],
          committed: ['a@nested.example', 'b@nested.example'],
        });
      });
    });
  });
}
