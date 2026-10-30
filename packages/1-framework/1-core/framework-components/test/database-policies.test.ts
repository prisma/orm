import type { ContractMarkerRecord } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  compareMarkerDatabasePolicies,
  DATABASE_POLICIES_META_KEY,
  type DatabasePolicies,
  DEFAULT_DATABASE_POLICIES,
  databasePoliciesMovedFailure,
  databasePoliciesOf,
  databasePolicyDifferences,
  movedDatabasePoliciesWhy,
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

describe('compareMarkerDatabasePolicies', () => {
  it('holds the defaults when the marker records nothing', () => {
    expect(compareMarkerDatabasePolicies(markerWithMeta({}), DEFAULT_DATABASE_POLICIES)).toEqual({
      kind: 'held',
    });
  });

  it('reports the policies another run recorded as moved, with the policies found', () => {
    expect(
      compareMarkerDatabasePolicies(
        markerWithMeta({ policies: MIGRATE_ONLY }),
        DEFAULT_DATABASE_POLICIES,
      ),
    ).toEqual({ kind: 'moved', found: MIGRATE_ONLY });
  });

  it('reports a marker whose policies cannot be read as unreadable, not moved', () => {
    expect(
      compareMarkerDatabasePolicies(markerWithMeta({ policies: 'x' }), DEFAULT_DATABASE_POLICIES),
    ).toMatchObject({ kind: 'unreadable', why: expect.stringContaining('meta.policies') });
  });
});

describe('databasePoliciesMovedFailure', () => {
  it('names each moved setting and carries the policies, not the hashes', () => {
    const found: DatabasePolicies = { ...DEFAULT_DATABASE_POLICIES, change: ['reconcile'] };

    const failure = databasePoliciesMovedFailure(DEFAULT_DATABASE_POLICIES, found);

    expect({ code: failure.code, why: failure.why, meta: failure.meta }).toEqual({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      why: "The database's policies changed after this run checked them: change moved from migrate, reconcile to reconcile. Run the command again to check them anew.",
      meta: {
        reason: 'databasePolicies',
        space: 'app',
        checkedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        foundDatabasePolicies: found,
      },
    });
  });
});

describe('movedDatabasePoliciesWhy', () => {
  it('names every setting that moved, from the value checked to the value found', () => {
    expect(movedDatabasePoliciesWhy('db sign', DEFAULT_DATABASE_POLICIES, MIGRATE_ONLY)).toBe(
      "The database's policies changed after db sign checked them: change moved from migrate, reconcile to migrate; dataProtection.dataLoss moved from data-loss-with-consent to data-loss-forbidden; dataProtection.accessWidening moved from access-widening-with-consent to access-widening-forbidden.",
    );
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
