import type { ContractMarkerRecord } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type DatabasePolicies,
  DEFAULT_POLICIES,
  policiesOf,
  policyDifferences,
} from '../src/control/control-migration-types';

function markerWithMeta(meta: Record<string, unknown>): ContractMarkerRecord {
  return {
    storageHash: 'a'.repeat(64),
    profileHash: 'a'.repeat(64),
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
}

const MIGRATE_ONLY: DatabasePolicies = {
  change: ['migrate'],
  dataProtection: {
    dataLoss: 'data-loss-forbidden',
    accessWidening: 'access-widening-forbidden',
  },
};

describe('policiesOf', () => {
  it('gives the defaults when there is no marker', () => {
    expect(policiesOf(undefined)).toEqual(DEFAULT_POLICIES);
  });

  it('gives the defaults when the marker records no policies', () => {
    expect(policiesOf(markerWithMeta({}))).toEqual(DEFAULT_POLICIES);
  });

  it('reads the policies the marker records', () => {
    expect(policiesOf(markerWithMeta({ policies: MIGRATE_ONLY }))).toEqual(MIGRATE_ONLY);
  });

  it('fills settings the marker leaves out from the defaults', () => {
    expect(
      policiesOf(
        markerWithMeta({
          policies: { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-permitted' } },
        }),
      ),
    ).toEqual({
      change: ['migrate'],
      dataProtection: {
        dataLoss: 'data-loss-permitted',
        accessWidening: 'access-widening-with-consent',
      },
    });
  });

  it('sorts the change strategies', () => {
    expect(
      policiesOf(markerWithMeta({ policies: { change: ['reconcile', 'migrate'] } })).change,
    ).toEqual(['migrate', 'reconcile']);
  });

  it.each([
    ['a string', 'migrate-only'],
    ['an unknown strategy', { change: ['deploy'] }],
    ['an unknown data loss level', { dataProtection: { dataLoss: 'anything-goes' } }],
    ['an unknown key', { change: ['migrate'], mode: 'strict' }],
  ])('fails as an unreadable marker when meta.policies is %s', (_, policies) => {
    expect(() => policiesOf(markerWithMeta({ policies }))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.MARKER_READ_FAILED' }),
    );
  });
});

describe('policyDifferences', () => {
  it('finds nothing when the declaration is empty', () => {
    expect(policyDifferences({}, MIGRATE_ONLY)).toEqual([]);
  });

  it('compares only the settings the declaration carries', () => {
    expect(policyDifferences({ change: ['migrate'] }, DEFAULT_POLICIES)).toEqual([
      { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
    ]);
  });

  it('compares change strategies as a set', () => {
    expect(policyDifferences({ change: ['reconcile', 'migrate'] }, DEFAULT_POLICIES)).toEqual([]);
  });

  it('reports each differing data protection setting', () => {
    expect(
      policyDifferences(
        {
          dataProtection: {
            dataLoss: 'data-loss-forbidden',
            accessWidening: 'access-widening-with-consent',
          },
        },
        DEFAULT_POLICIES,
      ),
    ).toEqual([
      {
        setting: 'dataLoss',
        declared: 'data-loss-forbidden',
        inForce: 'data-loss-with-consent',
      },
    ]);
  });

  it('reports every setting that differs, in a fixed order', () => {
    expect(
      policyDifferences(
        {
          dataProtection: { accessWidening: 'access-widening-forbidden' },
          change: ['migrate'],
        },
        DEFAULT_POLICIES,
      ),
    ).toEqual([
      { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
      {
        setting: 'accessWidening',
        declared: 'access-widening-forbidden',
        inForce: 'access-widening-with-consent',
      },
    ]);
  });
});
