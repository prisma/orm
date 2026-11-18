/**
 * Database policies on PostgreSQL and SQLite: a database whose change policy permits only
 * migrations refuses `db update`, its dry run and `db sign`; a database with no marker is still
 * signed; ref writers keep what a ref declares; and a database with no policies behaves as before.
 */

import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  definePolicyEnforcementJourneys,
  type WithPolicyProject,
} from './utils/database-policies-enforcement';
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

  describe('database policies (PostgreSQL)', () => {
    definePolicyEnforcementJourneys(onPostgres, timeouts.spinUpPpgDev);
  });

  describe('database policies (SQLite)', () => {
    definePolicyEnforcementJourneys(onSqlite, timeouts.spinUpPpgDev);
  });
});
