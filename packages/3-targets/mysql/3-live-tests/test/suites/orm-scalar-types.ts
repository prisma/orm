import type { JsonValue } from '@internal/contract/types';
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

const itemsDatabase = [
  'CREATE TABLE `Drawer` (`id` int NOT NULL, PRIMARY KEY (`id`))',
  'CREATE TABLE `Item` (`id` int NOT NULL, `on` tinyint(1) NOT NULL, `data` longblob NOT NULL, `doc` json NOT NULL, `extra` json NULL, `drawerId` int NOT NULL, PRIMARY KEY (`id`))',
  'INSERT INTO `Drawer` VALUES (1)',
] as const;

/** Long enough that TO_BASE64 breaks its text into lines of 76 characters. */
const LONG_BYTES = new Uint8Array(Array.from({ length: 300 }, (_, index) => (index * 7) % 256));

const items = [
  {
    id: 1,
    on: true,
    data: new Uint8Array(),
    doc: { b: [1, null, 'it\'s "quoted" 🙂'], a: { nested: true }, n: -12.5 },
    extra: null,
    drawerId: 1,
  },
  {
    id: 2,
    on: false,
    data: new Uint8Array([0xc3, 0x28]),
    doc: [1, 'two', {}, []],
    extra: 'text',
    drawerId: 1,
  },
  { id: 3, on: true, data: LONG_BYTES, doc: 'a string document', extra: 0, drawerId: 1 },
  { id: 4, on: false, data: new Uint8Array([0]), doc: true, extra: [], drawerId: 1 },
] as const satisfies readonly {
  id: number;
  on: boolean;
  data: Uint8Array;
  doc: JsonValue;
  extra: JsonValue;
  drawerId: number;
}[];

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

  describe(`${server.displayName} reads and writes Boolean, Bytes and Json through the ORM`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('writes and reads each type at its edges', async (test) => {
      await withSeededDatabase(test, server, itemsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Item.createAll([...items]);
        const rows = await db.orm.Item.orderBy((item) => item.id.asc()).all();
        expectTypeOf(rows[0]?.on).toEqualTypeOf<boolean | undefined>();
        expectTypeOf(rows[0]?.data).toEqualTypeOf<Uint8Array | undefined>();
        expectTypeOf(rows[0]?.doc).toEqualTypeOf<JsonValue | undefined>();
        expectTypeOf(rows[0]?.extra).toEqualTypeOf<JsonValue | null | undefined>();
        expect(rows).toEqual(items);
        expect(rows.map((row) => row.data.constructor)).toEqual(items.map(() => Uint8Array));
      });
    });

    it('reads JSON null as null, as it reads SQL NULL, though only SQL NULL is NULL to the server', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [
          ...itemsDatabase,
          `INSERT INTO \`Item\` VALUES (1, 1, '', 'null', 'null', 1), (2, 0, '', '{}', NULL, 1)`,
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          expect({
            rows: await db.orm.Item.orderBy((item) => item.id.asc())
              .select('id', 'doc', 'extra')
              .all(),
            sqlNull: await db.orm.Item.where({ extra: null }).select('id').all(),
          }).toEqual({
            rows: [
              { id: 1, doc: null, extra: null },
              { id: 2, doc: {}, extra: null },
            ],
            sqlNull: [{ id: 2 }],
          });
        },
      );
    });

    it('refuses to write a value its column does not hold', async (test) => {
      await withSeededDatabase(test, server, itemsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const [item] = items;
        const write = (changes: Record<string, unknown>) =>
          db.orm.Item.create({ ...item, ...changes } as never);
        await expect(write({ on: 1 })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message: expect.stringContaining('Cannot write 1 to '),
        });
        await expect(write({ data: '00ff' })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        await expect(write({ doc: { when: new Date(0) } })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message: expect.stringContaining('Cannot write Date at when to '),
        });
        await expect(write({ doc: [1, Number.NaN] })).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
        });
        expect(await db.orm.Item.all()).toEqual([]);
      });
    });

    it('refuses to read a tinyint(1) holding a value other than 0 or 1, from a row and through an include, naming the column', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [...itemsDatabase, "INSERT INTO `Item` VALUES (1, 2, '', '{}', NULL, 1)"],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          const refusal = {
            code: 'RUNTIME.DECODE_FAILED',
            message: expect.stringContaining(
              'Column "Item"."on" holds 2, which is not 0 or 1. mysql/boolean@1 reads 0 as false and 1 as true.',
            ),
          };
          await expect(db.orm.Item.select('id', 'on').all()).rejects.toMatchObject(refusal);
          await expect(db.orm.Drawer.include('items').all()).rejects.toMatchObject(refusal);
        },
      );
    });

    it('filters a boolean and bytes by equality, and orders bytes bytewise', async (test) => {
      await withSeededDatabase(test, server, itemsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Item.createAll([...items]);
        const ids = async (rows: PromiseLike<readonly { readonly id: number }[]>) =>
          (await rows).map((row) => row.id);
        expect({
          on: await ids(
            db.orm.Item.where((item) => item.on.eq(true))
              .orderBy((item) => item.id.asc())
              .select('id')
              .all(),
          ),
          off: await ids(
            db.orm.Item.where({ on: false })
              .orderBy((item) => item.id.asc())
              .select('id')
              .all(),
          ),
          bytes: await ids(
            db.orm.Item.where((item) => item.data.eq(new Uint8Array([0xc3, 0x28])))
              .select('id')
              .all(),
          ),
          byBytes: await ids(
            db.orm.Item.orderBy((item) => item.data.asc())
              .select('id')
              .all(),
          ),
        }).toEqual({ on: [1, 3], off: [2, 4], bytes: [2], byBytes: [1, 4, 3, 2] });
      });
    });

    it('reads each type through an include as it reads it from a row', async (test) => {
      await withSeededDatabase(test, server, itemsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        await db.orm.Item.createAll([...items]);
        const drawer = await db.orm.Drawer.include('items', (item) =>
          item.orderBy((row) => row.id.asc()),
        ).first({ id: 1 });
        expect(drawer).toEqual({ id: 1, items });
      });
    });
  });
}
