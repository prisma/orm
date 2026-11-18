import { errorMarkerPoliciesCorrupt } from '@internal/errors/execution';
import {
  APP_SPACE_ID,
  compareMarkerDatabasePolicies,
  type DatabasePolicies,
  databasePoliciesMovedFailure,
  type MigrationRunnerFailure,
} from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { notOk, okVoid, type Result } from '@internal/utils/result';
import type { SqlControlFamilyInstance } from '../control-instance';

/**
 * Compares the policies a caller checked with the application space's marker. A runner calls it before
 * its first space, under its lock or inside its transaction: a change fails the run as
 * `MIGRATION.MARKER_CAS_FAILURE`, and policies that cannot be read throw `CONTRACT.MARKER_ROW_CORRUPT`.
 */
export async function checkDatabasePoliciesHeld(
  family: SqlControlFamilyInstance,
  driver: SqlControlDriverInstance<string>,
  checked: DatabasePolicies,
): Promise<Result<void, MigrationRunnerFailure>> {
  const comparison = compareMarkerDatabasePolicies(
    await family.readMarker({ driver, space: APP_SPACE_ID }),
    checked,
  );
  switch (comparison.kind) {
    case 'held':
      return okVoid();
    case 'moved':
      return notOk(databasePoliciesMovedFailure(checked, comparison.found));
    case 'unreadable':
      throw errorMarkerPoliciesCorrupt({
        why: comparison.why,
        space: APP_SPACE_ID,
        markerLocation: family.markerLocation,
      });
  }
}
