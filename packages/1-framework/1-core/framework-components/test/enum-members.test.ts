import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { AnyCodecDescriptor } from '../src/shared/codec-descriptor';
import type { CodecLookupWithDescriptors } from '../src/shared/codec-types';
import { emptyCodecLookup } from '../src/shared/codec-types';
import { dataType } from '../src/shared/data-type';
import { type DecodedEnum, encodeEnumMembers } from '../src/shared/enum-members';

function encode(decodedEnum: DecodedEnum, codecLookup: CodecLookupWithDescriptors) {
  const result = encodeEnumMembers(decodedEnum, codecLookup);
  return result.ok ? { ok: true, value: result.value } : { ok: false, failure: result.failure };
}

const anyJsonType = dataType('test/any-json', { read: (json) => json });

function codecOf(
  id: string,
  toStored: (value: unknown) => JsonValue,
  fromStored: (json: JsonValue) => unknown,
): Codec {
  return {
    id,
    dataType: anyJsonType,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (value) => anyJsonType.valueFrom(toStored(value), {}),
    fromDataTypeValue: (value) => fromStored(value.value),
  };
}

const prefixed = codecOf(
  'test/prefixed@1',
  (v) => `s:${String(v)}`,
  (j) => String(j).slice('s:'.length),
);
const shouting = codecOf(
  'test/shouting@1',
  (v) => String(v).toUpperCase(),
  (j) => j,
);
const refusing = codecOf(
  'test/refusing@1',
  (v) => {
    if (v === 'bad') throw new Error('bad is not allowed');
    return String(v);
  },
  (j) => j,
);
const lowerCasing = codecOf(
  'test/lower-casing@1',
  (v) => String(v).toLowerCase(),
  (j) => String(j).toLowerCase(),
);

function lookupOf(
  codecs: readonly Codec[],
  descriptors: Record<string, Partial<AnyCodecDescriptor>> = {},
): CodecLookupWithDescriptors {
  return {
    ...emptyCodecLookup,
    get: (id) => codecs.find((codec) => codec.id === id),
    descriptorFor: (id) =>
      ({ codecId: id, traits: ['equality'], ...descriptors[id] }) as AnyCodecDescriptor,
  };
}

const lookup = lookupOf([prefixed, shouting, refusing, lowerCasing]);

describe('encodeEnumMembers', () => {
  it('stores each member as its codec encodes it', () => {
    expect(
      encode(
        {
          codecId: 'test/prefixed@1',
          enumMembers: [
            { name: 'Active', value: 'active' },
            { name: 'Paused', value: 'paused' },
          ],
        },
        lookup,
      ),
    ).toEqual({
      ok: true,
      value: [
        { name: 'Active', value: 's:active' },
        { name: 'Paused', value: 's:paused' },
      ],
    });
  });

  it('refuses a codec an enum cannot use, and stops there', () => {
    expect(
      encode(
        { codecId: 'test/opaque@1', enumMembers: [{ name: 'A', value: 'a' }] },
        lookupOf([], { 'test/opaque@1': { traits: [] } }),
      ),
    ).toEqual({
      ok: false,
      failure: [
        {
          kind: 'codec-not-for-enums',
          refusal:
            'The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.',
        },
      ],
    });
  });

  it('refuses a codec the lookup does not have', () => {
    expect(
      encode({ codecId: 'test/missing@1', enumMembers: [{ name: 'A', value: 'a' }] }, lookupOf([])),
    ).toEqual({ ok: false, failure: [{ kind: 'codec-missing' }] });
  });

  it('names each member the codec refuses, with the codec error as the cause', () => {
    const result = encode(
      {
        codecId: 'test/refusing@1',
        enumMembers: [
          { name: 'Good', value: 'good' },
          { name: 'Bad', value: 'bad' },
        ],
      },
      lookup,
    );
    expect(result).toEqual({
      ok: false,
      failure: [
        {
          kind: 'codec-refused-member',
          member: 'Bad',
          reason: 'bad is not allowed',
          cause: new Error('bad is not allowed'),
        },
      ],
    });
  });

  it('refuses a member that reads back as another value, with the value to write', () => {
    expect(
      encode(
        { codecId: 'test/shouting@1', enumMembers: [{ name: 'Quiet', value: 'quiet' }] },
        lookup,
      ),
    ).toEqual({
      ok: false,
      failure: [
        {
          kind: 'member-not-stored-as-written',
          member: 'Quiet',
          written: '"quiet"',
          stored: 'QUIET',
          writeAs: '"QUIET"',
        },
      ],
    });
  });

  it('refuses two members stored as the same value', () => {
    expect(
      encode(
        {
          codecId: 'test/lower-casing@1',
          enumMembers: [
            { name: 'First', value: 'same' },
            { name: 'Second', value: 'same' },
          ],
        },
        lookup,
      ),
    ).toEqual({
      ok: false,
      failure: [
        { kind: 'duplicate-member-value', earlier: 'First', later: 'Second', stored: 'same' },
      ],
    });
  });

  it('does not compare a member with no literal type', () => {
    const dates = codecOf(
      'test/date@1',
      (v) => (v as Date).toISOString(),
      (j) => new Date(String(j)),
    );
    const moment = new Date('2024-01-01T00:00:00.000Z');
    expect(
      encode(
        { codecId: 'test/date@1', enumMembers: [{ name: 'Start', value: moment }] },
        lookupOf([dates]),
      ),
    ).toEqual({ ok: true, value: [{ name: 'Start', value: '2024-01-01T00:00:00.000Z' }] });
  });
});
