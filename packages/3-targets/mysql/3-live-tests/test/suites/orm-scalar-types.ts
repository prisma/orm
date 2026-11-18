import { timeouts } from '@repo/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

const DECIMAL_MAX = `${'9'.repeat(35)}.${'9'.repeat(30)}`;
const DECIMAL_TINY = `-0.${'0'.repeat(29)}1`;
const PADDED_ZERO = `0.${'0'.repeat(30)}`;

const measuresDatabase = [
  'CREATE TABLE `Shelf` (`id` int NOT NULL, PRIMARY KEY (`id`))',
  'CREATE TABLE `Measure` (`id` int NOT NULL, `count` bigint NOT NULL, `ratio` double NOT NULL, `amount` decimal(65,30) NOT NULL, `price` decimal(10,2) NOT NULL, `label` text NOT NULL, `shelfId` int NOT NULL, PRIMARY KEY (`id`))',
  'INSERT INTO `Shelf` VALUES (1)',
] as const;

/** Two decimals a double cannot tell apart: compared as doubles, the second equals 0.1. */
const nearTenthDatabase = [
  ...measuresDatabase,
  `INSERT INTO \`Measure\` VALUES (1, 1, 0.1, 0.1, 0.10, 'a', 1), (2, 2, 0.1, 0.100000000000000000000000000001, 0.10, 'b', 1)`,
] as const;

const measure = {
  id: 1,
  count: Number.MAX_SAFE_INTEGER,
  ratio: 5e-324,
  amount: DECIMAL_MAX,
  price: '12345678.90',
  label: 'it\'s "text" 🙂',
  shelfId: 1,
};

const measureRead = { ...measure, amount: DECIMAL_MAX };

const lowest = {
  id: 2,
  count: Number.MIN_SAFE_INTEGER,
  ratio: -1e308,
  amount: DECIMAL_TINY,
  price: '-0.5',
  label: '',
  shelfId: 1,
} as const;

const lowestRead = { ...lowest, amount: DECIMAL_TINY, price: '-0.50' };

export function describeOrmScalarTypes(server: LiveServer): void {
  describe(`${server.displayName} reads and writes the scalar convenience types through the ORM`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('writes and reads each type at its boundaries, a decimal as the server prints it', async (test) => {
      await withSeededDatabase(test, server, measuresDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Measure.createAll([measure, lowest]);
        await db.orm.Measure.create({ ...lowest, id: 3, amount: '1.5', price: '-0.0', ratio: 0.1 });
        const rows = await db.orm.Measure.orderBy((m) => m.id.asc()).all();
        expectTypeOf(rows[0]?.count).toEqualTypeOf<number | undefined>();
        expectTypeOf(rows[0]?.ratio).toEqualTypeOf<number | undefined>();
        expectTypeOf(rows[0]?.amount).toEqualTypeOf<string | undefined>();
        expect(rows).toEqual([
          measureRead,
          lowestRead,
          {
            ...lowestRead,
            id: 3,
            amount: `1.5${'0'.repeat(29)}`,
            price: '0.00',
            ratio: 0.1,
          },
        ]);
      });
    });

    it('refuses to write a value its column would not read back unchanged', async (test) => {
      await withSeededDatabase(test, server, measuresDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const write = (changes: Partial<typeof measure>) =>
          db.orm.Measure.create({ ...measure, ...changes });
        await expect(write({ count: 2 ** 53 })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ ratio: Number.NaN })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ ratio: Number.POSITIVE_INFINITY })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ amount: `1${'0'.repeat(35)}` })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ amount: `0.${'1'.repeat(31)}` })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ amount: '1e5' })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        expect(await db.orm.Measure.all()).toEqual([]);
      });
    });

    it('refuses to read a bigint past the safe integer range as a number, naming the column', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [
          ...measuresDatabase,
          `INSERT INTO \`Measure\` VALUES (1, 9007199254740993, 0, 0, 0, '', 1)`,
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          await expect(db.orm.Measure.select('id', 'count').all()).rejects.toMatchObject({
            code: 'RUNTIME.DECODE_FAILED',
            message: expect.stringContaining(
              'Column "Measure"."count" holds 9007199254740993, which is not an integer within the safe integer range.',
            ),
          });
        },
      );
    });

    it('filters a decimal by equality, by a list and by order exactly, where both servers would compare the text of a parameter as a double', async (test) => {
      await withSeededDatabase(test, server, nearTenthDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const ids = async (rows: PromiseLike<readonly { readonly id: number }[]>) =>
          (await rows).map((row) => row.id);
        expect({
          equal: await ids(
            db.orm.Measure.where((m) => m.amount.eq('0.1'))
              .select('id')
              .all(),
          ),
          inList: await ids(
            db.orm.Measure.where((m) => m.amount.in(['0.1', '99']))
              .select('id')
              .all(),
          ),
          above: await ids(
            db.orm.Measure.where((m) => m.amount.gt('0.1'))
              .select('id')
              .all(),
          ),
          byObject: await ids(
            db.orm.Measure.where({ amount: '0.100000000000000000000000000001' }).select('id').all(),
          ),
        }).toEqual({ equal: [1], inList: [1], above: [2], byObject: [2] });
      });
    });

    it('reads each type through an include as it reads it from a row', async (test) => {
      await withSeededDatabase(test, server, measuresDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Measure.createAll([measure, lowest]);
        const shelf = await db.orm.Shelf.include('measures', (m) =>
          m.orderBy((row) => row.id.asc()),
        ).first({ id: 1 });
        expect(shelf).toEqual({ id: 1, measures: [measureRead, lowestRead] });
      });
    });

    it('sums a decimal exactly and a double as a double, and takes the extremes of each', async (test) => {
      await withSeededDatabase(test, server, nearTenthDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const totals = await db.orm.Measure.aggregate((a) => ({
          amount: a.sum('amount'),
          ratio: a.sum('ratio'),
          meanRatio: a.avg('ratio'),
          count: a.sum('count'),
          most: a.max('amount'),
        }));
        expect(totals).toEqual({
          amount: '0.200000000000000000000000000001',
          ratio: 0.2,
          meanRatio: 0.1,
          count: 3,
          most: '0.100000000000000000000000000001',
        });
      });
    });

    it('reads a decimal zero as the server prints it in its column', async (test) => {
      await withSeededDatabase(test, server, measuresDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Measure.create({ ...measure, amount: '-0' });
        expect(await db.orm.Measure.select('amount').all()).toEqual([{ amount: PADDED_ZERO }]);
      });
    });
  });
}
