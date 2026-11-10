import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';

function contractWithVariant(entry: unknown) {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    domain: {
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {},
              storage: { fields: {} },
              discriminator: { field: 'type' },
              variants: { bug: entry },
            },
          },
        },
      },
    },
    storage: { namespaces: {} },
  };
}

describe('variant entry schema', () => {
  it('accepts a reference to the variant model', () => {
    const contract = contractWithVariant({ namespace: 'app', model: 'Bug' });
    expect(MongoContractSchema(contract)).toEqual(contract);
  });

  it.each([null, 'Bug', {}, { model: 'Bug' }, { namespace: 'app' }])(
    'rejects malformed entry %j',
    (entry) => {
      expect(MongoContractSchema(contractWithVariant(entry))).toBeInstanceOf(type.errors);
    },
  );
});
