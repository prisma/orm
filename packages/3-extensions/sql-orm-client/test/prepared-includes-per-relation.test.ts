import { describe, expect, it } from 'vitest';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from './collection-fixtures';

const perRelationContract = withoutCapabilityKeys(baseContract, [
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
]);

const refusal = expect.objectContaining({
  code: 'ORM.CAPABILITY_MISSING',
  meta: expect.objectContaining({
    capabilities: [
      'sql.jsonAgg',
      'sql.outerReferencesInDerivedTables',
      'sql.jsonAggWithoutTruncation',
    ],
  }),
});

describe('a prepared read with includes when includes load with one query per relation', () => {
  it.each(['all', 'first', 'firstOrThrow'] as const)('is refused by prepared.%s()', (method) => {
    const { collection } = createCollectionFor('User', perRelationContract);
    const prepared = collection.include('posts').prepared;

    expect(() => prepared[method]()).toThrow(refusal);
  });

  it('is not refused without includes', () => {
    const { collection } = createCollectionFor('User', perRelationContract);

    expect(() => collection.prepared.all()).not.toThrow();
  });

  it('is not refused when includes load in one query', () => {
    const { collection } = createCollectionFor('User');

    expect(() => collection.include('posts').prepared.all()).not.toThrow();
  });
});
