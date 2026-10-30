import type { ContractMarkerRecord } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  DATABASE_POLICIES_META_KEY,
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
  databasePoliciesOf,
  databasePolicyDifferences,
  markerHoldsDatabasePolicies,
  PartialDatabasePoliciesSchema,
  storedDatabasePolicies,
  withDeclaredDatabasePolicies,
} from '../src/control/database-policies';

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

describe('databasePoliciesOf', () => {
  it('gives the defaults when there is no marker', () => {
    expect(databasePoliciesOf(undefined).assertOk()).toEqual(DEFAULT_DATABASE_POLICIES);
  });

  it('gives the defaults when the marker records no policies', () => {
    expect(databasePoliciesOf(markerWithMeta({})).assertOk()).toEqual(DEFAULT_DATABASE_POLICIES);
  });

  it('reads the policies the marker records under the policies key', () => {
    expect(DATABASE_POLICIES_META_KEY).toBe('policies');
    expect(databasePoliciesOf(markerWithMeta({ policies: MIGRATE_ONLY })).assertOk()).toEqual(
      MIGRATE_ONLY,
    );
  });

  it('fills settings the marker leaves out from the defaults, and sorts the strategies', () => {
    expect(
      databasePoliciesOf(
        markerWithMeta({
          policies: {
            change: ['reconcile', 'migrate'],
            dataProtection: { dataLoss: 'data-loss-permitted' },
          },
        }),
      ).assertOk(),
    ).toEqual({
      change: ['migrate', 'reconcile'],
      dataProtection: {
        dataLoss: 'data-loss-permitted',
        accessWidening: 'access-widening-with-consent',
      },
    });
  });

  it.each([
    ['a string', 'migrate-only'],
    ['an empty change policy', { change: [] }],
    ['an unknown strategy', { change: ['deploy'] }],
    ['an unknown data loss level', { dataProtection: { dataLoss: 'anything-goes' } }],
    ['an unknown key', { change: ['migrate'], mode: 'strict' }],
  ])('returns why the policies cannot be read when meta.policies is %s', (_, policies) => {
    expect(databasePoliciesOf(markerWithMeta({ policies })).assertNotOk()).toEqual({
      why: expect.stringContaining("The marker's meta.policies is not a valid policy declaration"),
    });
  });
});

describe('databasePolicyDifferences', () => {
  it('finds nothing when the declaration is empty', () => {
    expect(databasePolicyDifferences({}, MIGRATE_ONLY)).toEqual([]);
  });

  it('compares change strategies as a set', () => {
    expect(
      databasePolicyDifferences({ change: ['reconcile', 'migrate'] }, DEFAULT_DATABASE_POLICIES),
    ).toEqual([]);
  });

  it('names each differing setting by its key path in the ref, in a fixed order', () => {
    expect(
      databasePolicyDifferences(
        {
          dataProtection: {
            accessWidening: 'access-widening-forbidden',
            dataLoss: 'data-loss-forbidden',
          },
          change: ['migrate'],
        },
        DEFAULT_DATABASE_POLICIES,
      ),
    ).toEqual([
      { setting: 'change', declared: ['migrate'], inForce: ['migrate', 'reconcile'] },
      {
        setting: 'dataProtection.dataLoss',
        declared: 'data-loss-forbidden',
        inForce: 'data-loss-with-consent',
      },
      {
        setting: 'dataProtection.accessWidening',
        declared: 'access-widening-forbidden',
        inForce: 'access-widening-with-consent',
      },
    ]);
  });
});

describe('withDeclaredDatabasePolicies', () => {
  it('lays the declared settings over those in force', () => {
    expect(
      withDeclaredDatabasePolicies(DEFAULT_DATABASE_POLICIES, {
        change: ['migrate'],
        dataProtection: { accessWidening: 'access-widening-forbidden' },
      }),
    ).toEqual({
      change: ['migrate'],
      dataProtection: {
        dataLoss: 'data-loss-with-consent',
        accessWidening: 'access-widening-forbidden',
      },
    });
  });
});

describe('markerHoldsDatabasePolicies', () => {
  it('holds the defaults when the marker records nothing, and not after another run recorded others', () => {
    expect({
      empty: markerHoldsDatabasePolicies(markerWithMeta({}), DEFAULT_DATABASE_POLICIES),
      changed: markerHoldsDatabasePolicies(
        markerWithMeta({ policies: MIGRATE_ONLY }),
        DEFAULT_DATABASE_POLICIES,
      ),
      corrupt: markerHoldsDatabasePolicies(
        markerWithMeta({ policies: 'x' }),
        DEFAULT_DATABASE_POLICIES,
      ),
    }).toEqual({ empty: true, changed: false, corrupt: false });
  });
});

describe('storedDatabasePolicies', () => {
  it('stores plain JSON that reads back as the same policies', () => {
    const stored = storedDatabasePolicies({ ...MIGRATE_ONLY, change: ['reconcile', 'migrate'] });
    expect(JSON.parse(JSON.stringify(stored))).toEqual({
      change: ['migrate', 'reconcile'],
      dataProtection: MIGRATE_ONLY.dataProtection,
    });
    expect(PartialDatabasePoliciesSchema.allows(stored)).toBe(true);
  });
});
