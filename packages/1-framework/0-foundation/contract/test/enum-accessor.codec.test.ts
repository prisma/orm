import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import type { ContractEnum } from '../src/domain-types';
import {
  buildEnumsMapForNamespace,
  buildNamespacedEnums,
  createEnumAccessor,
  type EnumMemberCodec,
} from '../src/enum-accessor';
import type { JsonValue } from '../src/types';

const DECIMAL_INTEGER = /^-?\d+$/;

// Stores a bigint as decimal text and, like `pg/int8@1`, also stores a safe-integer number.
const bigintTextCodec: EnumMemberCodec = {
  decodeJson(json: JsonValue) {
    if (typeof json !== 'string' || !DECIMAL_INTEGER.test(json)) {
      throw new Error(`not decimal text: ${JSON.stringify(json)}`);
    }
    return BigInt(json);
  },
  encodeJson(value: unknown) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    throw new Error(`not an integer: ${String(value)}`);
  },
};

const dateCodec: EnumMemberCodec = {
  decodeJson(json: JsonValue) {
    if (typeof json !== 'string') throw new Error('not a date string');
    return new Date(json);
  },
  encodeJson(value: unknown) {
    if (!(value instanceof Date)) throw new Error('not a Date');
    return value.toISOString();
  },
};

const levelEnum: ContractEnum = {
  codecId: 'test/bigint@1',
  members: [
    { name: 'Low', value: '1' },
    { name: 'High', value: '10' },
  ],
};

const launchEnum: ContractEnum = {
  codecId: 'test/date@1',
  members: [
    { name: 'Launch', value: '2024-01-01T00:00:00Z' },
    { name: 'Sunset', value: '2025-06-30T12:00:00.000Z' },
  ],
};

const launch = '2024-01-01T00:00:00.000Z';
const sunset = '2025-06-30T12:00:00.000Z';

describe('createEnumAccessor() with the enum codec', () => {
  it('holds each member as the value the codec reads from its stored form', () => {
    const level = createEnumAccessor(levelEnum, bigintTextCodec);
    expect({ values: level.values, names: level.names, members: level.members }).toEqual({
      values: [1n, 10n],
      names: ['Low', 'High'],
      members: { Low: 1n, High: 10n },
    });
  });

  it('holds date members as dates', () => {
    const dates = createEnumAccessor(launchEnum, dateCodec);
    expect(dates.members).toEqual({ Launch: new Date(launch), Sunset: new Date(sunset) });
  });

  it('finds a value equal to a member, compared as the codec stores it', () => {
    const level = createEnumAccessor(levelEnum, bigintTextCodec);
    const dates = createEnumAccessor(launchEnum, dateCodec);
    expect({
      has: level.has(10n),
      nameOf: level.nameOf(10n),
      ordinalOf: level.ordinalOf(10n),
      hasDate: dates.has(new Date(launch)),
      nameOfDate: dates.nameOf(new Date(sunset)),
      ordinalOfDate: dates.ordinalOf(new Date(sunset)),
    }).toEqual({
      has: true,
      nameOf: 'High',
      ordinalOf: 1,
      hasDate: true,
      nameOfDate: 'Sunset',
      ordinalOfDate: 1,
    });
  });

  it('does not find a value that is no member', () => {
    const level = createEnumAccessor(levelEnum, bigintTextCodec);
    expect({
      has: level.has(2n),
      nameOf: level.nameOf(2n),
      ordinalOf: level.ordinalOf(2n),
    }).toEqual({ has: false, nameOf: undefined, ordinalOf: -1 });
  });

  it('does not find a value the codec refuses, and does not throw', () => {
    const level = createEnumAccessor(levelEnum, bigintTextCodec);
    const dates = createEnumAccessor(launchEnum, dateCodec);
    expect({
      text: level.has('ten'),
      nul: level.has(null),
      dateText: dates.has(launch),
      notDate: dates.ordinalOf({}),
    }).toEqual({ text: false, nul: false, dateText: false, notDate: -1 });
  });

  it('does not find a value of another type that the codec stores as a member', () => {
    const level = createEnumAccessor(levelEnum, bigintTextCodec);
    expect({
      number: level.has(10),
      text: level.has('10'),
      nameOf: level.nameOf(1),
    }).toEqual({ number: false, text: false, nameOf: undefined });
  });

  it('passes on an internal error the codec raises', () => {
    const broken = new Date(0);
    const failing: EnumMemberCodec = {
      decodeJson: (json) => new Date(json as string),
      encodeJson: (value) => {
        if (value === broken) throw new InternalError('codec bug');
        return (value as Date).toISOString();
      },
    };
    const accessor = createEnumAccessor(launchEnum, failing);
    expect(() => accessor.has(broken)).toThrow(InternalError);
  });

  it('refuses a member the codec does not read', () => {
    const malformed: ContractEnum = {
      codecId: 'test/bigint@1',
      members: [{ name: 'Low', value: 'one' }],
    };
    expect(() => createEnumAccessor(malformed, bigintTextCodec)).toThrow('not decimal text: "one"');
  });
});

describe('createEnumAccessor() without a codec', () => {
  it('holds and compares the stored forms', () => {
    const level = createEnumAccessor(levelEnum);
    expect({
      members: level.members,
      hasStored: level.has('10'),
      hasDecoded: level.has(10n),
    }).toEqual({ members: { Low: '1', High: '10' }, hasStored: true, hasDecoded: false });
  });
});

describe('buildNamespacedEnums() with codecs', () => {
  const domain = {
    namespaces: {
      public: { models: {}, enum: { Level: levelEnum, Launch: launchEnum } },
    },
  };
  const codecs: Record<string, EnumMemberCodec> = {
    'test/bigint@1': bigintTextCodec,
    'test/date@1': dateCodec,
  };

  it('reads each enum through the codec its codecId names', () => {
    const enums = buildNamespacedEnums(domain, (codecId) => codecs[codecId]);
    expect({
      level: enums['public']?.['Level']?.members,
      launch: enums['public']?.['Launch']?.values,
    }).toEqual({
      level: { Low: 1n, High: 10n },
      launch: [new Date(launch), new Date(sunset)],
    });
  });

  it('keeps the stored forms of an enum whose codec the lookup does not have', () => {
    const enums = buildEnumsMapForNamespace(domain, 'public', () => undefined);
    expect(enums['Level']?.members).toEqual({ Low: '1', High: '10' });
  });
});
