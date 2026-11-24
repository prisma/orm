import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer } from './test-sql-contract-serializer';

const serializer = new TestSqlContractSerializer();

const printed = serializer.serializeContract(
  serializer.deserializeContract({
    formatVersion: 1,
    ...createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
        },
      },
    }),
  }),
);

function refusal(document: unknown): unknown {
  try {
    serializer.deserializeContract(document);
  } catch (error) {
    return error;
  }
  throw new Error('expected the contract to be refused');
}

describe('SQL contract file format version 1', () => {
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
