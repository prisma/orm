import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createMongoContractSchema } from '../src/contract-schema';

const contract = {
  targetFamily: 'mongo',
  roots: {},
  domain: { namespaces: { main: { models: {} } } },
  storage: { namespaces: { main: { id: 'main', entries: { collection: { users: {} } } } } },
};

describe('Mongo contract schema and hints', () => {
  const schema = createMongoContractSchema();

  it('accepts the contract without hints', () => {
    expect(schema(contract) instanceof type.errors).toBe(false);
  });

  it('rejects a hints section', () => {
    const hints = { namespaces: { main: { tables: { users: { was: 'people' } } } } };
    expect(schema({ ...contract, hints }) instanceof type.errors).toBe(true);
  });
});
