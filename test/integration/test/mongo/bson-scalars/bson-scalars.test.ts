import type { JsonValue } from '@internal/contract/types';
import type { BsonValue } from '@internal/target-mongo/codec-types';
import { Binary, type Code, DBRef, Decimal128, Long, type MinKey, ObjectId } from 'mongodb';
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
          raw: null,
        });
        await db.posts.create({
          views: 7n,
          price: '0.015',
          thumbnail: new Uint8Array([]),
          meta: [1, 'two'],
          notes: 'plain text',
          raw: null,
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
    'writes BSON values into a Bson field through the ORM and reads them back with their types',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const objectId = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
        const uuid = new Uint8Array(16).fill(9);
        await db.posts.create({
          views: 1n,
          price: '1',
          thumbnail: new Uint8Array([1]),
          meta: {},
          notes: null,
          raw: {
            objectId,
            long: Long.fromBigInt(2n ** 60n),
            decimal: Decimal128.fromString('1234.5600'),
            uuid: new Binary(uuid, 4),
            nested: { list: [1, 'two', { deep: objectId }] },
            pattern: /^ab+c$/gi,
          },
        });

        const stored = await mongoDb.collection('posts').findOne({});
        expect(stored?.['raw']?.['objectId']).toBeInstanceOf(ObjectId);

        const [row] = await db.posts.all();
        const raw = row?.raw as Record<string, Record<string, unknown>>;
        const pattern = raw['pattern'];
        expect(pattern).toBeInstanceOf(RegExp);
        expect([
          (pattern as unknown as RegExp).source,
          (pattern as unknown as RegExp).flags,
        ]).toEqual(['^ab+c$', 'gi']);
        expect({
          objectId: [raw['objectId']?.['_bsontype'], raw['objectId']?.toString()],
          long: [raw['long']?.['_bsontype'], raw['long']?.toString()],
          decimal: [raw['decimal']?.['_bsontype'], raw['decimal']?.toString()],
          uuid: [
            raw['uuid']?.['_bsontype'],
            raw['uuid']?.['sub_type'],
            [...(raw['uuid'] as unknown as Binary).value()],
          ],
          deep: (raw['nested'] as { list: [number, string, { deep: ObjectId }] }).list[2].deep
            ._bsontype,
          list: (raw['nested'] as { list: unknown[] }).list.slice(0, 2),
        }).toEqual({
          objectId: ['ObjectId', '64b7f0c2a1b2c3d4e5f60718'],
          long: ['Long', (2n ** 60n).toString()],
          decimal: ['Decimal128', '1234.5600'],
          uuid: ['Binary', 4, [...uuid]],
          deep: 'ObjectId',
          list: [1, 'two'],
        });

        type Row = (typeof row & object)['raw'];
        expectTypeOf<Row>().toEqualTypeOf<BsonValue | null>();
        expectTypeOf<Code>().toExtend<Row>();
        expectTypeOf<MinKey>().toExtend<Row>();
        expectTypeOf<RegExp>().toExtend<Row>();
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'reads a DBRef stored in a Bson field as the document it holds, and round-trips { $ref, $id } through the ORM',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        const id = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
        await mongoDb.collection('posts').insertOne({
          views: Long.fromNumber(1),
          price: Decimal128.fromString('1'),
          thumbnail: new Binary(new Uint8Array([1])),
          meta: {},
          notes: null,
          raw: { link: new DBRef('authors', id, 'blog') },
        });
        await db.posts.create({
          views: 2n,
          price: '2',
          thumbnail: new Uint8Array([2]),
          meta: {},
          notes: null,
          raw: { $ref: 'authors', $id: id },
        });

        const rows = await db.posts.orderBy({ views: 1 }).all();
        expect(rows.map((row) => row.raw)).toEqual([
          { link: { $ref: 'authors', $id: id, $db: 'blog' } },
          { $ref: 'authors', $id: id },
        ]);
        const [stored, created] = rows.map((row) => row.raw as Record<string, unknown>);
        const storedLink = stored?.['link'] as Record<string, unknown> | undefined;
        expect(storedLink?.['$id']).toBeInstanceOf(ObjectId);
        expect(created).not.toBeInstanceOf(DBRef);
        expect(created?.['$id']).toBeInstanceOf(ObjectId);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses to read a Json field that holds a date, naming its path inside the field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('posts').insertOne({
          views: Long.fromNumber(1),
          price: Decimal128.fromString('1'),
          thumbnail: new Binary(new Uint8Array([1])),
          meta: { events: [{ at: new Date(0) }] },
          notes: null,
        });

        await expect(db.posts.all()).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          message: expect.stringContaining(
            'mongo/json@1 wire value contains a non-JSON BSON date at events.0.at',
          ),
          details: {
            codecId: 'mongo/json@1',
            received: 'date',
            valuePath: 'events.0.at',
            collection: 'posts',
            path: 'meta',
          },
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'installs a validator that refuses a Json field holding a non-JSON value at its top level',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ mongoDb }) => {
        const document = {
          views: Long.fromNumber(1),
          price: Decimal128.fromString('1'),
          thumbnail: new Binary(new Uint8Array([1])),
          notes: null,
        };
        await mongoDb.collection('posts').insertOne({ ...document, meta: { at: 1 } });
        await expect(
          mongoDb.collection('posts').insertOne({ ...document, meta: new Date(0) }),
        ).rejects.toMatchObject({ code: 121 });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses to write a BSON look-alike into a Bson field, naming its path inside the field',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.posts.create({
            views: 1n,
            price: '1',
            thumbnail: new Uint8Array([1]),
            meta: {},
            notes: null,
            raw: { nested: [{ _bsontype: 'MinKey' }] },
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field raw in collection 'posts' with codec 'mongo/bson@1': mongo/bson@1 value must be a BSON value; received MinKey not created by bson 7 at nested.0",
          details: {
            label: 'raw',
            collection: 'posts',
            valuePath: 'nested.0',
          },
        });
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
