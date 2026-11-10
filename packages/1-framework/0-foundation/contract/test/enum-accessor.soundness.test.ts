import { describe, expect, it } from 'vitest';
import type { ContractEnum } from '../src/domain-types';
import { createEnumAccessor } from '../src/enum-accessor';
import type { JsonValue } from '../src/types';
import { enumMemberCodec, type StoredFormConversions } from './support/enum-member-codec';

// Like `pg/uuid@1`, stores lower-case text and writes any text it is given in lower case.
const lowerCaseCodec = enumMemberCodec({
  fromStored(json: JsonValue) {
    if (typeof json !== 'string' || json !== json.toLowerCase()) throw new Error('not lower case');
    return json;
  },
  toStored: (value: unknown) => String(value).toLowerCase(),
});

// Like `sqlite/datetime@1`, writes whatever `toISOString()` returns, for a Date or anything else.
const lenientDateConversions: StoredFormConversions = {
  fromStored: (json: JsonValue) => new Date(String(json)),
  toStored: (value: unknown) => (value as { toISOString(): string }).toISOString(),
};
const lenientDateCodec = enumMemberCodec(lenientDateConversions);

const floatCodec = enumMemberCodec({
  fromStored: (json: JsonValue) => Number(json),
  toStored: (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : String(value),
});

const bytesCodec = enumMemberCodec({
  fromStored: (json: JsonValue) => Uint8Array.from(json as number[]),
  toStored: (value: unknown) => Array.from(value as Uint8Array),
});

const keyEnum: ContractEnum = {
  codecId: 'test/lower@1',
  members: [{ name: 'First', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }],
};
const launch = '2024-01-01T00:00:00.000Z';
const launchEnum: ContractEnum = {
  codecId: 'test/date@1',
  members: [{ name: 'Launch', value: launch }],
};
const specialEnum: ContractEnum = {
  codecId: 'test/float@1',
  members: [
    { name: 'Nan', value: 'NaN' },
    { name: 'Inf', value: 'Infinity' },
  ],
};
const bytesEnum: ContractEnum = {
  codecId: 'test/bytes@1',
  members: [{ name: 'Magic', value: [1, 2, 3] }],
};

describe('createEnumAccessor() finds only values equal to a member', () => {
  it('does not find text that the codec would store as a member but that differs from it', () => {
    const key = createEnumAccessor(keyEnum, lowerCaseCodec);
    const upper = 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11';
    expect({
      has: key.has(upper),
      nameOf: key.nameOf(upper),
      ordinalOf: key.ordinalOf(upper),
      member: key.has('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
    }).toEqual({ has: false, nameOf: undefined, ordinalOf: -1, member: true });
  });

  it('does not find an object of another kind that the codec stores as a member', () => {
    const dates = createEnumAccessor(launchEnum, lenientDateCodec);
    const dateLike = { toISOString: () => launch };
    expect({
      dateLike: dates.has(dateLike),
      dateLikeName: dates.nameOf(dateLike),
      date: dates.has(new Date(launch)),
    }).toEqual({ dateLike: false, dateLikeName: undefined, date: true });
  });

  it('finds NaN and the infinities', () => {
    const special = createEnumAccessor(specialEnum, floatCodec);
    expect({
      nan: special.nameOf(Number.NaN),
      inf: special.ordinalOf(Number.POSITIVE_INFINITY),
      text: special.has('NaN'),
    }).toEqual({ nan: 'Nan', inf: 1, text: false });
  });
});

describe('createEnumAccessor() hands out a fresh object for each read of an object member', () => {
  it('keeps a member unchanged when a caller changes a date it read', () => {
    const dates = createEnumAccessor(launchEnum, lenientDateCodec);
    const read = dates.members['Launch'] as Date;
    read.setUTCFullYear(2030);
    const fromValues = dates.values[0] as Date;
    fromValues.setUTCFullYear(2031);
    const secondRead = dates.members['Launch'];
    expect({
      member: dates.members['Launch'],
      value: dates.values[0],
      has: dates.has(dates.members['Launch']),
      nameOf: dates.nameOf(new Date(launch)),
      changed: dates.has(read),
      fresh: secondRead === dates.members['Launch'],
    }).toEqual({
      member: new Date(launch),
      value: new Date(launch),
      has: true,
      nameOf: 'Launch',
      changed: false,
      fresh: false,
    });
  });

  it('keeps a member unchanged when a caller changes bytes it read', () => {
    const bytes = createEnumAccessor(bytesEnum, bytesCodec);
    const read = bytes.members['Magic'] as Uint8Array;
    read[0] = 9;
    expect({ member: bytes.members['Magic'], has: bytes.has(Uint8Array.of(1, 2, 3)) }).toEqual({
      member: Uint8Array.of(1, 2, 3),
      has: true,
    });
  });

  it('keeps a member unchanged when the codec reads it as a frozen date', () => {
    const frozenDates = createEnumAccessor(
      launchEnum,
      enumMemberCodec({
        ...lenientDateConversions,
        fromStored: (json: JsonValue) => Object.freeze(new Date(String(json))),
      }),
    );
    (frozenDates.members['Launch'] as Date).setTime(0);
    (frozenDates.values[0] as Date).setTime(0);
    expect({ member: frozenDates.members['Launch'], value: frozenDates.values[0] }).toEqual({
      member: new Date(launch),
      value: new Date(launch),
    });
  });

  it('keeps a stored object unchanged without a codec', () => {
    const shapes = createEnumAccessor({
      codecId: 'test/json@1',
      members: [{ name: 'Origin', value: { x: 0 } }],
    });
    (shapes.members['Origin'] as { x: number }).x = 5;
    expect(shapes.members['Origin']).toEqual({ x: 0 });
  });
});
