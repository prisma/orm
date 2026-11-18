import { describe, expect, it } from 'vitest';
import type { ContractEnum } from '../src/domain-types';
import {
  buildEnumsMapForNamespace,
  createEnumAccessor,
  type EnumMemberCodec,
} from '../src/enum-accessor';
import type { JsonValue } from '../src/types';
import { enumMemberCodec } from './support/enum-member-codec';

function countingCodec(decode: (json: JsonValue) => unknown): {
  readonly codec: EnumMemberCodec;
  readonly decodes: () => number;
} {
  let count = 0;
  return {
    codec: enumMemberCodec({
      fromStored(json) {
        count += 1;
        return decode(json);
      },
      toStored: (value) => (value instanceof Date ? value.toISOString() : String(value)),
    }),
    decodes: () => count,
  };
}

/** Stands in for a Temporal value: an immutable object whose kind names a Temporal type. */
class FakeInstant {
  readonly [Symbol.toStringTag] = 'Temporal.Instant';
  constructor(readonly text: string) {}
  toString(): string {
    return this.text;
  }
}

const domainOf = (enums: Record<string, ContractEnum>) => ({
  namespaces: { public: { enum: enums } },
});

const levelEnum: ContractEnum = {
  codecId: 'test/level@1',
  members: [
    { name: 'Low', value: '1' },
    { name: 'High', value: '10' },
  ],
};

describe('buildEnumsMapForNamespace() decodes an enum when it is first read', () => {
  it('resolves every codec when it builds, so a missing codec fails then', () => {
    const domain = domainOf({ Level: levelEnum });
    expect(() =>
      buildEnumsMapForNamespace(domain, 'public', (codecId) => {
        throw new Error(`no codec ${codecId}`);
      }),
    ).toThrow('no codec test/level@1');
  });

  it('decodes no member until the enum is read, and each member once however often it is read', () => {
    const { codec, decodes } = countingCodec((json) => BigInt(String(json)));
    const enums = buildEnumsMapForNamespace(domainOf({ Level: levelEnum }), 'public', () => codec);
    const beforeRead = decodes();
    const level = enums['Level'];
    const reads = [level?.members['Low'], level?.values, level?.values, level?.has(10n)];

    expect({ beforeRead, afterReads: decodes(), reads }).toEqual({
      beforeRead: 0,
      afterReads: 2,
      reads: [1n, [1n, 10n], [1n, 10n], true],
    });
  });

  it('does not fail to build when a member cannot be decoded, only when its enum is read', () => {
    const codec = enumMemberCodec({
      fromStored: () => {
        throw new Error('cannot decode here');
      },
      toStored: (value) => String(value),
    });
    const enums = buildEnumsMapForNamespace(domainOf({ Level: levelEnum }), 'public', () => codec);
    expect(() => enums['Level']?.values).toThrow('cannot decode here');
  });
});

describe('createEnumAccessor() hands out cached immutable members and copies mutable ones', () => {
  it('hands out the same value on every read of a primitive or Temporal member', () => {
    const instants = createEnumAccessor(
      { codecId: 'test/instant@1', members: [{ name: 'Launch', value: '2024-01-01T00:00:00Z' }] },
      countingCodec((json) => new FakeInstant(String(json))).codec,
    );
    const levels = createEnumAccessor(
      levelEnum,
      countingCodec((json) => BigInt(String(json))).codec,
    );

    const reads = () => ({
      instantMember: instants.members['Launch'],
      instantValues: instants.values,
      levelValues: levels.values,
    });
    const first = reads();
    const second = reads();

    expect({
      instantMember: Object.is(first.instantMember, second.instantMember),
      instantValues: Object.is(first.instantValues, second.instantValues),
      levelValues: Object.is(first.levelValues, second.levelValues),
    }).toEqual({ instantMember: true, instantValues: true, levelValues: true });
  });

  it('decodes a date member once and hands out a copy on every read', () => {
    const { codec, decodes } = countingCodec((json) => new Date(String(json)));
    const dates = createEnumAccessor(
      { codecId: 'test/date@1', members: [{ name: 'Launch', value: '2024-01-01T00:00:00.000Z' }] },
      codec,
    );
    const first = dates.members['Launch'];
    const second = dates.members['Launch'];
    const firstValues = dates.values;
    const secondValues = dates.values;

    expect({
      decodes: decodes(),
      equal: first,
      sameObject: Object.is(first, second),
      sameValues: Object.is(firstValues, secondValues),
    }).toEqual({
      decodes: 1,
      equal: new Date('2024-01-01T00:00:00.000Z'),
      sameObject: false,
      sameValues: false,
    });
  });

  it('decodes a bytes member once and hands out a copy on every read', () => {
    const { codec, decodes } = countingCodec((json) => Uint8Array.from(String(json), Number));
    const bytes = createEnumAccessor(
      { codecId: 'test/bytes@1', members: [{ name: 'Magic', value: '123' }] },
      codec,
    );
    const first = bytes.members['Magic'];
    const second = bytes.members['Magic'];

    expect({ decodes: decodes(), equal: first, sameObject: Object.is(first, second) }).toEqual({
      decodes: 1,
      equal: Uint8Array.of(1, 2, 3),
      sameObject: false,
    });
  });
});
