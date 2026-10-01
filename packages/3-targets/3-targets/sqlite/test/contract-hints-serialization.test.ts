import { describe, expect, it } from 'vitest';
import { SqliteContractSerializer } from '../src/core/sqlite-contract-serializer';
import contractJson from './fixtures/sqlite-contract.json' with { type: 'json' };

const hints = {
  namespaces: {
    __unbound__: {
      tables: {
        users: { was: 'accounts' },
      },
    },
  },
};

describe('SQLite contract hints section', () => {
  const serializer = new SqliteContractSerializer();

  it('round-trips the section through deserialize and serialize', () => {
    const contract = serializer.deserializeContract({ ...contractJson, hints });
    expect(contract.hints).toEqual(hints);
    expect(JSON.parse(JSON.stringify(serializer.serializeContract(contract))).hints).toEqual(hints);
  });

  it('rejects an unknown key inside the section', () => {
    expect(() =>
      serializer.deserializeContract({ ...contractJson, hints: { ...hints, extra: {} } }),
    ).toThrow(/hints/);
  });
});
