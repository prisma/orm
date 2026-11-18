import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  dataType,
  emptyCodecLookup,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { encodeEnumTypeMembers } from '../src/enum-members';
import { enumType, member } from '../src/enum-type';

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

const codecs = [
  codecOf(
    'test/object@1',
    (v) => v as JsonValue,
    (j) => j,
  ),
  codecOf(
    'test/shouting@1',
    (v) => String(v).toUpperCase(),
    (j) => j,
  ),
  codecOf(
    'test/refusing@1',
    (v) => {
      if (v === 'bad') throw new Error('bad is not allowed');
      return String(v);
    },
    (j) => j,
  ),
];

const lookup: CodecLookupWithDescriptors = {
  ...emptyCodecLookup,
  get: (id) => codecs.find((codec) => codec.id === id),
  descriptorFor: (id) =>
    ({
      codecId: id,
      traits: id === 'test/opaque@1' ? [] : ['equality'],
    }) as unknown as AnyCodecDescriptor,
};

function encode(handle: Parameters<typeof encodeEnumTypeMembers>[0]) {
  return () => encodeEnumTypeMembers(handle, lookup, 'the store');
}

describe('encodeEnumTypeMembers', () => {
  it('returns each member as its codec stores it', () => {
    expect(
      encode(enumType('Shape', { codecId: 'test/object@1' }, member('Square', { sides: 4 })))(),
    ).toEqual([{ name: 'Square', value: { sides: 4 } }]);
  });

  it('refuses a codec an enum cannot use', () => {
    expect(encode(enumType('Key', { codecId: 'test/opaque@1' }, member('A', 'a')))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Key"): an enum cannot use the codec test/opaque@1. The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.',
        meta: { enumName: 'Key', codecId: 'test/opaque@1', reason: 'codec-not-for-enums' },
      }),
    );
  });

  it('refuses a codec no pack provides', () => {
    expect(encode(enumType('Key', { codecId: 'test/missing@1' }, member('A', 'a')))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK',
        meta: { codecId: 'test/missing@1' },
      }),
    );
  });

  it('names a member its codec refuses', () => {
    expect(
      encode(
        enumType(
          'Key',
          { codecId: 'test/refusing@1' },
          member('Good', 'good'),
          member('Bad', 'bad'),
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Key") member "Bad" has a value its codec test/refusing@1 refuses: bad is not allowed',
        meta: {
          enumName: 'Key',
          member: 'Bad',
          codecId: 'test/refusing@1',
          reason: 'codec-refused-member',
        },
      }),
    );
  });

  it('refuses a member stored as another value, in the family terms it is given', () => {
    expect(
      encode(enumType('Key', { codecId: 'test/shouting@1' }, member('Quiet', 'quiet'))),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Key"): member "Quiet" is written "quiet", but the store stores "QUIET". Write the member as "QUIET".',
        meta: { enumName: 'Key', member: 'Quiet', reason: 'member-not-stored-as-written' },
      }),
    );
  });

  it('refuses two members that store the same value, naming both and the stored form', () => {
    expect(
      encode(
        enumType(
          'Shape',
          { codecId: 'test/object@1' },
          member('Square', { width: 2, height: 2 }),
          member('Triangle', { sides: 3 }),
          member('Box', { height: 2, width: 2 }),
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Shape"): members "Square" and "Box" both store {"height":2,"width":2}. Member values must be unique as their codec stores them.',
        meta: { enumName: 'Shape', members: ['Square', 'Box'], reason: 'duplicate-member-value' },
      }),
    );
  });
});
