import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializerBase } from '../src/core/ir/mongo-contract-serializer-base';
import { mongoContractJson } from './mongo-contract-json-fixture';

class PlainSerializer extends MongoContractSerializerBase<MongoContract> {
  protected constructTargetContract(validated: MongoContract): MongoContract {
    return validated;
  }
}

const serializer = new PlainSerializer();
const printed = serializer.serializeContract(serializer.deserializeContract(mongoContractJson({})));

function refusal(document: unknown): unknown {
  try {
    serializer.deserializeContract(document);
  } catch (error) {
    return error;
  }
  throw new Error('expected the contract to be refused');
}

describe('MongoDB contract file format version 1', () => {
  it('prints the format version first', () => {
    expect(Object.keys(printed)[0]).toBe('formatVersion');
    expect(printed['formatVersion']).toBe(1);
  });

  it('parses what it prints into the same contract', () => {
    const parsed = serializer.deserializeContract(printed);
    expect(parsed).not.toHaveProperty('formatVersion');
    expect(JSON.parse(JSON.stringify(serializer.serializeContract(parsed)))).toEqual(
      JSON.parse(JSON.stringify(printed)),
    );
  });

  it('refuses a file written by a newer release', () => {
    expect(refusal({ ...printed, formatVersion: 2 })).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
    });
  });

  it('refuses a file with no format version', () => {
    const { formatVersion: _, ...withoutVersion } = printed;
    expect(refusal(withoutVersion)).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
  });

  it('refuses a file a pre-release wrote, with schemaVersion', () => {
    const { formatVersion: _, ...withoutVersion } = printed;
    expect(refusal({ schemaVersion: '1', ...withoutVersion })).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
    });
  });

  it('refuses a field it does not know', () => {
    expect(refusal({ ...printed, unknownField: true })).toMatchObject({
      code: 'CONTRACT.VALIDATION_FAILED',
    });
  });
});
