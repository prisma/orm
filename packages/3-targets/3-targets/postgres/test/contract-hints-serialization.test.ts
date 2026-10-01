import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

const hints = {
  namespaces: {
    public: {
      tables: {
        users: { was: 'Profile' },
      },
    },
  },
};

describe('Postgres contract hints section', () => {
  const serializer = new PostgresContractSerializer();

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
