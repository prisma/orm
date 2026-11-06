import type { ContractMarkerRecord } from '@internal/contract/types';
import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { markerSwapFailure } from '../src/core/marker-policies';

function marker(storageHash: string, meta: Record<string, unknown>): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
}

describe('markerSwapFailure', () => {
  it('reports a moved storage hash first, whatever the policies', () => {
    const found = marker('moved', { policies: 'strict' });

    expect(markerSwapFailure(found, 'expected', DEFAULT_DATABASE_POLICIES)).toEqual({
      kind: 'storageHashMoved',
      found,
    });
  });

  it('reports a deleted marker as a moved storage hash', () => {
    expect(markerSwapFailure(null, 'expected', DEFAULT_DATABASE_POLICIES)).toEqual({
      kind: 'storageHashMoved',
      found: null,
    });
  });

  it('reports a swap that guarded no policies, with the hash held, as a changed marker', () => {
    const found = marker('expected', { policies: { change: ['migrate'] } });

    expect(markerSwapFailure(found, 'expected', undefined)).toEqual({
      kind: 'markerChanged',
      found,
    });
  });

  it('reports the policies found when they moved and the hash held', () => {
    expect(
      markerSwapFailure(
        marker('expected', { policies: { change: ['migrate'] } }),
        'expected',
        DEFAULT_DATABASE_POLICIES,
      ),
    ).toEqual({
      kind: 'policiesMoved',
      found: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
    });
  });

  it('reports policies it cannot read when the hash held', () => {
    expect(
      markerSwapFailure(
        marker('expected', { policies: 'strict' }),
        'expected',
        DEFAULT_DATABASE_POLICIES,
      ),
    ).toMatchObject({ kind: 'policiesUnreadable' });
  });

  it('reports a marker that holds both again, changed and changed back in between, as a changed marker', () => {
    const found = marker('expected', {});

    expect(markerSwapFailure(found, 'expected', DEFAULT_DATABASE_POLICIES)).toEqual({
      kind: 'markerChanged',
      found,
    });
  });
});
