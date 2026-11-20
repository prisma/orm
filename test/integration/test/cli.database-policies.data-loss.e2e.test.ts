/**
 * The data protection policy's `dataLoss` setting on PostgreSQL and SQLite: `db update` refuses,
 * asks or proceeds under its three levels; `db migrate` refuses a recorded lossy migration under
 * `data-loss-forbidden`; `--permit-policy-change` loosens or tightens it; and `migration plan --to
 * <ref>` refuses a plan the ref forbids.
 */

import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { definePolicyDataLossJourneys } from './utils/database-policies-data-loss';
import type { WithPolicyProject } from './utils/database-policies-enforcement';
import { setupPolicyProject } from './utils/database-policies-journey';

withTempDir(({ createTempDir }) => {
  const onPostgres: WithPolicyProject = (_test, fn) =>
    withDevDatabase(({ connectionString }) =>
      fn(setupPolicyProject('postgres', createTempDir(), connectionString)),
    );
  const onSqlite: WithPolicyProject = (_test, fn) => {
    const testDir = createTempDir();
    return fn(setupPolicyProject('sqlite', testDir, join(testDir, 'policies.db')));
  };

  describe('data protection, data loss (PostgreSQL)', () => {
    definePolicyDataLossJourneys(onPostgres, timeouts.spinUpPpgDev);
  });

  describe('data protection, data loss (SQLite)', () => {
    definePolicyDataLossJourneys(onSqlite, timeouts.spinUpPpgDev);
  });
});
