import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { getAllTableColumns, resolveRowIdentityColumns } from '../src/collection-contract';

type ContractArg = Parameters<typeof resolveRowIdentityColumns>[0];

function contractWhoseLookupThrows(error: Error): ContractArg {
  const namespaces = {};
  Object.defineProperty(namespaces, '__unbound__', {
    get: () => {
      throw error;
    },
  });
  return { storage: { namespaces } } as unknown as ContractArg;
}

const ambiguous = structuredError('CONTRACT.TABLE_AMBIGUOUS', 'two namespaces declare "t"');
const unrelated = new Error('the lookup was ambiguous');

describe('a table lookup that fails because the name is in more than one namespace', () => {
  it('getAllTableColumns passes the CONTRACT.TABLE_AMBIGUOUS error through, whatever its message', () => {
    expect(() =>
      getAllTableColumns(contractWhoseLookupThrows(ambiguous), '__unbound__', 't'),
    ).toThrow(ambiguous);
  });

  it('resolveRowIdentityColumns passes the CONTRACT.TABLE_AMBIGUOUS error through, whatever its message', () => {
    expect(() =>
      resolveRowIdentityColumns(contractWhoseLookupThrows(ambiguous), '__unbound__', 't'),
    ).toThrow(ambiguous);
  });
});

describe('a table lookup that fails with another error whose message says "ambiguous"', () => {
  it('getAllTableColumns reports the table as unknown', () => {
    expect(() =>
      getAllTableColumns(contractWhoseLookupThrows(unrelated), '__unbound__', 't'),
    ).toThrow(expect.objectContaining({ code: 'ORM.TABLE_UNKNOWN' }));
  });

  it('resolveRowIdentityColumns resolves to no identity columns', () => {
    expect(
      resolveRowIdentityColumns(contractWhoseLookupThrows(unrelated), '__unbound__', 't'),
    ).toEqual([]);
  });
});
