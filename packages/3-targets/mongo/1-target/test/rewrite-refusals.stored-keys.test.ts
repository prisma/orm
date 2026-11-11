import type { ContractWithDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { rewriteRefusals } from '../src/core/migrations/mongo-rewrite-refusals';

const noModels = { domain: { namespaces: {} } } as unknown as ContractWithDomain;

function timeSeriesRefusal(kind: 'renameStoredKey' | 'removeStoredKey' | 'fillStoredKey') {
  return rewriteRefusals(
    {
      kind,
      collection: 'readings',
      field: 'sensor',
      variant: undefined,
      model: undefined,
      storedKey: undefined,
    },
    noModels,
    { timeSeries: true, validator: undefined },
  );
}

describe('rewrite refusals of keys inside a field', () => {
  it('refuse a key rename in a time-series collection', () => {
    expect(timeSeriesRefusal('renameStoredKey')).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename a key inside field "sensor" in collection "readings": it is a time-series collection',
        why: "MongoDB updates the documents of a time-series collection only through its metaField, so the key cannot be renamed in the documents. Keep the key's name in the contract, then run this command again.",
      },
    ]);
  });

  it('refuse a key removal in a time-series collection', () => {
    expect(timeSeriesRefusal('removeStoredKey')).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove a key inside field "sensor" in collection "readings": it is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the key cannot be removed from the documents that hold it. Keep the key in the contract, as an optional field if new documents leave it out, then run this command again.',
      },
    ]);
  });

  it('refuse a key fill in a time-series collection', () => {
    expect(timeSeriesRefusal('fillStoredKey')).toEqual([
      {
        kind: 'fieldFillRefused',
        summary:
          'Cannot fill a key inside field "sensor" in collection "readings": it is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the key cannot be filled in the documents. Make the key optional in the contract, then run this command again.',
      },
    ]);
  });
});
