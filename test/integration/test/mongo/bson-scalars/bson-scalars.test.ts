import type { JsonValue } from '@internal/contract/types';
import { Binary, Decimal128, Long } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const meta: JsonValue = { tags: ['a', 'b'], nested: { depth: 2, ok: true, none: null } };
const thumbnail = new Uint8Array([0, 1, 2, 250, 255]);

describe('Mongo Int64, Decimal128, Binary and Json fields', () => {
  it(
    'write through the ORM, store as BSON long, decimal and binData, and read back decoded',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.posts.create({
          views: 9_007_199_254_740_993n,
          price: '1234.5600',
          thumbnail,
          meta,
          notes: null,
        });
        await db.posts.create({
          views: 7n,
          price: '0.015',
          thumbnail: new Uint8Array([]),
          meta: [1, 'two'],
          notes: 'plain text',
        });

        const stored = await mongoDb.collection('posts').find().sort({ views: 1 }).toArray();
        expect(stored[1]?.['views']).toBeInstanceOf(Long);
        expect(stored[1]?.['price']).toBeInstanceOf(Decimal128);
        expect(stored[1]?.['thumbnail']).toBeInstanceOf(Binary);
        expect(stored[1]?.['meta']).toEqual(meta);

        const rows = await db.posts.orderBy({ views: 1 }).all();
        expect(
          rows.map(({ views, price, thumbnail: bytes, meta: value, notes }) => ({
            views,
            price,
            bytes: [...bytes],
            value,
            notes,
          })),
        ).toEqual([
          { views: 7n, price: '0.015', bytes: [], value: [1, 'two'], notes: 'plain text' },
          {
            views: 9_007_199_254_740_993n,
            price: '1234.5600',
            bytes: [...thumbnail],
            value: meta,
            notes: null,
          },
        ]);
        expect(rows[1]?.thumbnail).toBeInstanceOf(Uint8Array);

        type Row = (typeof rows)[number];
        expectTypeOf<Row['views']>().toEqualTypeOf<bigint>();
        expectTypeOf<Row['price']>().toEqualTypeOf<string>();
        expectTypeOf<Row['thumbnail']>().toEqualTypeOf<Uint8Array>();
        expectTypeOf<Row['meta']>().toEqualTypeOf<JsonValue>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'reads a Decimal128 stored in exponent form as plain decimal text',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('posts').insertOne({
          views: Long.fromNumber(1),
          price: Decimal128.fromString('1E+3'),
          thumbnail: new Binary(new Uint8Array([1])),
          meta: {},
          notes: null,
        });

        const [row] = await db.posts.all();
        expect(row?.price).toBe('1000');
        expect(row?.views).toBe(1n);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
