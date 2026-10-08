import type { ContractEnum } from '@internal/contract/types';
import {
  type DataTypeValue,
  dataType,
  dataTypeValueFor,
  readJsonString,
} from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { buildMongoEnums } from '../src/mongo-enums';
import type { MongoCodecLookup } from '../src/mongo-execution-stack';

const level: ContractEnum = {
  codecId: 'test/level@1',
  members: [
    { name: 'Low', value: '1' },
    { name: 'High', value: '10' },
  ],
};

const domain = { namespaces: { __unbound__: { enum: { Level: level } } } };

const levelType = dataType('test/level', { read: (json) => readJsonString('test/level', json) });

const levelCodecs: MongoCodecLookup = {
  get: (id) =>
    id === 'test/level@1'
      ? {
          id,
          dataType: levelType,
          toWire: async (value: unknown) => value,
          fromWire: async (wire: unknown) => wire,
          toDataTypeValue: (value: unknown) => dataTypeValueFor(levelType, {}, String(value)),
          fromDataTypeValue: (value: DataTypeValue) => BigInt(String(value.value)),
        }
      : undefined,
  has: (id) => id === 'test/level@1',
};

describe('buildMongoEnums', () => {
  it("reads each enum's members through its codec, by namespace", () => {
    const enums = buildMongoEnums({ domain } as never, levelCodecs);
    expect({
      namespaces: Object.keys(enums),
      members: enums['__unbound__']?.['Level']?.members,
    }).toEqual({ namespaces: ['__unbound__'], members: { Low: 1n, High: 10n } });
  });

  it('refuses a contract whose enum codec the lookup lacks', () => {
    expect(() =>
      buildMongoEnums({ domain } as never, { get: () => undefined, has: () => false }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        message:
          "No codec is registered for codecId 'test/level@1', which a domain enum in the contract uses.",
      }),
    );
  });
});
