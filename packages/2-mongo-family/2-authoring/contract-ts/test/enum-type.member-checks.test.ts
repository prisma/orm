import type { JsonValue } from '@internal/contract/types';
import type { AnyCodecDescriptor, Codec } from '@internal/framework-components/codec';
import { dataType, dataTypeId } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const fixtureType = dataType('demo/fixture', { read: (json) => json });

function descriptorOf(
  codecId: string,
  toStored: (value: unknown) => JsonValue,
  fromStored: (json: JsonValue) => unknown,
): AnyCodecDescriptor {
  return {
    codecId,
    dataType: dataTypeId('demo/fixture'),
    traits: ['equality'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () =>
      ({
        id: codecId,
        dataType: fixtureType,
        toWire: async (v: unknown) => v,
        fromWire: async (v: unknown) => v,
        toDataTypeValue: (value: unknown) => fixtureType.valueFrom(toStored(value), {}),
        fromDataTypeValue: (value) => fromStored(value.value),
      }) satisfies Codec,
  };
}

const target = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  types: {
    codecTypes: {
      codecDescriptors: [
        descriptorOf(
          'test/refusing@1',
          (v) => {
            if (v === 'bad') throw new Error('bad is not allowed');
            return String(v);
          },
          (j) => j,
        ),
        descriptorOf(
          'test/shouting@1',
          (v) => String(v).toUpperCase(),
          (j) => j,
        ),
      ],
    },
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

function build(handle: ReturnType<typeof enumType>) {
  const Holder = model('Holder', {
    collection: 'holders',
    fields: { _id: field.objectId(), value: field.namedType(handle) },
  });
  return () =>
    defineContract({
      family: mongoFamilyPack,
      target,
      enums: { [handle.enumName]: handle },
      models: { Holder },
    });
}

describe('defineContract() — enum members its codec cannot store as written', () => {
  it('names a member whose value the codec refuses', () => {
    const Grade = enumType(
      'Grade',
      { codecId: 'test/refusing@1' },
      member('Good', 'good'),
      member('Bad', 'bad'),
    );
    expect(build(Grade)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Grade") member "Bad" has a value its codec test/refusing@1 refuses: bad is not allowed',
        meta: {
          enumName: 'Grade',
          member: 'Bad',
          codecId: 'test/refusing@1',
          reason: 'codec-refused-member',
        },
      }),
    );
  });

  it('refuses a member the codec reads back as another value, with the value to write', () => {
    const Volume = enumType('Volume', { codecId: 'test/shouting@1' }, member('Quiet', 'quiet'));
    expect(build(Volume)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ENUM_INVALID',
        message:
          'enumType("Volume"): member "Quiet" is written "quiet", but the field stores "QUIET". Write the member as "QUIET".',
        meta: { enumName: 'Volume', member: 'Quiet', reason: 'member-not-stored-as-written' },
      }),
    );
  });
});
