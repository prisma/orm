/**
 * Database policies through `db migrate --to <ref>` and `migration status --to <ref>`, on PostgreSQL
 * and SQLite: a ref whose policies differ is refused before any migration runs, applied with
 * `--permit-policy-change`, recorded by a run with no migration, and reported by status.
 */

import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import type { WithPolicyProject } from './utils/database-policies-enforcement';
import { setupPolicyProject } from './utils/database-policies-journey';
import { definePolicyMigrateJourneys } from './utils/database-policies-migrate';

withTempDir(({ createTempDir }) => {
  const onPostgres: WithPolicyProject = (_test, fn) =>
    withDevDatabase(({ connectionString }) =>
      fn(setupPolicyProject('postgres', createTempDir(), connectionString)),
    );
  const onSqlite: WithPolicyProject = (_test, fn) => {
    const testDir = createTempDir();
    return fn(setupPolicyProject('sqlite', testDir, join(testDir, 'policies.db')));
  };

  describe('db migrate with database policies (PostgreSQL)', () => {
    definePolicyMigrateJourneys(onPostgres, timeouts.spinUpPpgDev);
  });

  describe('db migrate with database policies (SQLite)', () => {
    definePolicyMigrateJourneys(onSqlite, timeouts.spinUpPpgDev);
  });
});
