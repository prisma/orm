import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract as CommonContract } from './_fixture/common/generated/contract';
import commonContractJson from './_fixture/common/generated/contract.json' with { type: 'json' };
import type { Contract as DecimalContract } from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };
import type { Contract as EnumContract } from './_fixture/enum/generated/contract';
import enumContractJson from './_fixture/enum/generated/contract.json' with { type: 'json' };
import type { Contract as JsonContract } from './_fixture/json/generated/contract';
import jsonContractJson from './_fixture/json/generated/contract.json' with { type: 'json' };
import type { Contract as ListsContract } from './_fixture/lists/generated/contract';
import listsContractJson from './_fixture/lists/generated/contract.json' with { type: 'json' };

const longBytes = Uint8Array.from(
  Buffer.from(
    'VGhpcyBpcyBhIGxhcmdlIGJhc2U2NCBzdHJpbmcgdGhhdCBlbnN1cmVzIHdlIHNhbml0aXplIHRoZSBvdXRwdXQgb2YgTXlTUUwgYmFzZTY0IHN0cmluZy4=',
    'base64',
  ),
);
const shortBytes = Uint8Array.from(Buffer.from('FDSF', 'base64'));

/**
 * Replaces every `Temporal.Instant` in a result with its text, recursively.
 *
 * Running both the actual and the expected side through this keeps the whole-shape comparison
 * while putting the `dt` columns in the failure diff as text rather than as opaque objects.
 * `toEqual` does compare instants correctly on its own; `toMatchObject` would not, since a Temporal
 * value has no own enumerable properties for a subset matcher to find.
 *
 * Typed arrays are returned untouched; enumerating one would turn a `Uint8Array` into a record of
 * index keys and break the byte comparisons this suite also makes.
 */
function instantsAsText(value: unknown): unknown {
  if (value instanceof Temporal.Instant) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(instantsAsText);
  }
  if (value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, instantsAsText(inner)]),
    );
  }
  return value;
}

describe('ports/engines/queries/data_types/through_relation', () => {
  it(
    'common_types',
    () =>
      withPostgresPort<CommonContract>({ contractJson: commonContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        await db.public.Child.create({
          childId: 1,
          parentId: 1,
          string: 'abc',
          int: 1,
          bInt: 1n,
          float: 1.5,
          bytes: longBytes,
          bool: false,
          dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        });
        await db.public.Child.create({
          childId: 2,
          parentId: 1,
          string: 'def',
          int: -4234234,
          bInt: 14324324234324n,
          float: -2.54367,
          bytes: shortBytes,
          bool: true,
          dt: Temporal.Instant.from('1999-12-12T21:12:12.121Z'),
        });
        const query = db.public.Parent.include('children', (children) =>
          children.select('childId', 'string', 'int', 'bInt', 'float', 'bytes', 'bool', 'dt'),
        ).select('id');
        const expected = {
          id: 1,
          children: [
            {
              childId: 1,
              string: 'abc',
              int: 1,
              bInt: 1n,
              float: 1.5,
              bytes: longBytes,
              bool: false,
              dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
            },
            {
              childId: 2,
              string: 'def',
              int: -4234234,
              bInt: 14324324234324n,
              float: -2.54367,
              bytes: shortBytes,
              bool: true,
              dt: Temporal.Instant.from('1999-12-12T21:12:12.121Z'),
            },
          ],
        };
        expect(instantsAsText(await query.all())).toEqual(instantsAsText([expected]));
        expect(instantsAsText(await query.first({ id: 1 }))).toEqual(instantsAsText(expected));
        expect(await query.first({ id: 2 })).toBeNull();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'json_type',
    () =>
      withPostgresPort<JsonContract>({ contractJson: jsonContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        const values = [1, {}, { a: 'b' }, [], [1, -1, true, { a: 'b' }]];
        for (const [index, json] of values.entries()) {
          await db.public.Child.create({ childId: index + 1, parentId: 1, json });
        }
        const query = db.public.Parent.include('children', (children) =>
          children.select('childId', 'json'),
        ).select('id');
        const expected = {
          id: 1,
          children: values.map((json, index) => ({ childId: index + 1, json })),
        };
        expect(await query.all()).toEqual([expected]);
        expect(await query.first({ id: 1 })).toEqual(expected);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'enum_type',
    () =>
      withPostgresPort<EnumContract>({ contractJson: enumContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        for (const [index, value] of (['Red', 'Green', 'Blue'] as const).entries()) {
          await db.public.Child.create({ childId: index + 1, parentId: 1, enum: value });
        }
        const query = db.public.Parent.include('children', (children) =>
          children.select('childId', 'enum'),
        ).select('id');
        const expected = {
          id: 1,
          children: [
            { childId: 1, enum: 'Red' },
            { childId: 2, enum: 'Green' },
            { childId: 3, enum: 'Blue' },
          ],
        };
        expect(await query.all()).toEqual([expected]);
        expect(await query.first({ id: 1 })).toEqual(expected);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'decimal_type',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        for (const [index, dec] of ['1', '-1', '123.45678910', '95993.57'].entries()) {
          await db.public.Child.create({ childId: index + 1, parentId: 1, dec });
        }
        const query = db.public.Parent.include('children', (children) =>
          children.select('childId', 'dec'),
        ).select('id');
        const expected = {
          id: 1,
          children: [
            { childId: 1, dec: '1' },
            { childId: 2, dec: '-1' },
            { childId: 3, dec: '123.4567891' },
            { childId: 4, dec: '95993.57' },
          ],
        };
        expect(await query.orderBy((parent) => parent.id.asc()).all()).toEqual([expected]);
        expect(await query.first({ id: 1 })).toEqual(expected);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'scalar_lists',
    () =>
      withPostgresPort<ListsContract>({ contractJson: listsContractJson }, async ({ db }) => {
        await db.public.Parent.create({ id: 1 });
        const child = {
          childId: 1,
          parentId: 1,
          string: ['abc', 'def'],
          int: [1, -1, 1234567],
          bInt: [1n, -1n, 9223372036854775807n, -9223372036854775807n],
          float: [1.5, -1.5, 1.234567],
          bytes: [Uint8Array.from([1, 2, 3]), Uint8Array.from(Buffer.from('BONJOUR'))],
          bool: [false, true],
          dt: [
            Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
            Temporal.Instant.from('1999-12-12T21:12:12.121Z'),
          ],
          empty: [],
          unset: [],
        };
        Reflect.deleteProperty(child, 'unset');
        await db.public.Child.create(child);
        const query = db.public.Parent.include('children', (children) =>
          children.select(
            'childId',
            'string',
            'int',
            'bInt',
            'float',
            'bytes',
            'bool',
            'dt',
            'empty',
            'unset',
          ),
        ).select('id');
        const expected = {
          id: 1,
          children: [
            {
              childId: 1,
              string: ['abc', 'def'],
              int: [1, -1, 1234567],
              bInt: [1n, -1n, 9223372036854775807n, -9223372036854775807n],
              float: [1.5, -1.5, 1.234567],
              bytes: [Uint8Array.from([1, 2, 3]), Uint8Array.from(Buffer.from('BONJOUR'))],
              bool: [false, true],
              dt: [
                Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
                Temporal.Instant.from('1999-12-12T21:12:12.121Z'),
              ],
              empty: [],
              unset: [],
            },
          ],
        };
        expect(instantsAsText(await query.all())).toEqual(instantsAsText([expected]));
        expect(instantsAsText(await query.first({ id: 1 }))).toEqual(instantsAsText(expected));
      }),
    timeouts.spinUpPpgDev,
  );
});
