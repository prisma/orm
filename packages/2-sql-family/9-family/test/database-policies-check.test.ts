import type { ContractMarkerRecord } from '@internal/contract/types';
import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlControlFamilyInstance } from '../src/core/control-instance';
import { checkDatabasePoliciesHeld } from '../src/core/migrations/database-policies-check';

const driver = {} as SqlControlDriverInstance<string>;

function familyWithAppMeta(meta: Record<string, unknown>) {
  const spacesRead: string[] = [];
  const marker: ContractMarkerRecord = {
    storageHash: 'hash',
    profileHash: 'profile',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta,
    invariants: [],
  };
  const family = {
    markerLocation: 'prisma_contract.marker',
    readMarker: async ({ space }: { readonly space: string }) => {
      spacesRead.push(space);
      return marker;
    },
  } as unknown as SqlControlFamilyInstance;
  return { family, spacesRead };
}

describe('checkDatabasePoliciesHeld', () => {
  it("passes when the application space's marker still records the policies checked", async () => {
    const { family, spacesRead } = familyWithAppMeta({});

    const result = await checkDatabasePoliciesHeld(family, driver, DEFAULT_DATABASE_POLICIES);

    expect({ ok: result.ok, spacesRead }).toEqual({ ok: true, spacesRead: ['app'] });
  });

  it('fails as a concurrent change naming the policies found when they moved', async () => {
    const { family } = familyWithAppMeta({ policies: { change: ['migrate'] } });

    const result = await checkDatabasePoliciesHeld(family, driver, DEFAULT_DATABASE_POLICIES);

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      meta: {
        reason: 'databasePolicies',
        checkedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
        foundDatabasePolicies: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
      },
    });
  });

  it('throws a corrupt-marker error, keeping the marker, when the policies cannot be read', async () => {
    const { family } = familyWithAppMeta({ policies: 'strict' });

    await expect(
      checkDatabasePoliciesHeld(family, driver, DEFAULT_DATABASE_POLICIES),
    ).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      fix: expect.stringContaining('The marker for space "app" in prisma_contract.marker'),
      meta: { space: 'app' },
    });
  });
});
