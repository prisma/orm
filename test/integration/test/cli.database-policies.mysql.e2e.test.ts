/**
 * Database policies on MySQL: a database whose change policy permits only migrations refuses
 * `db update`, its dry run and `db sign`; a database with no marker is still signed; ref writers
 * keep what a ref declares; a database with no policies behaves as before; and the `db migrate
 * --to <ref>` journeys. Skipped when `MYSQL_URL` is not set.
 */

import { timeouts } from '@repo/test-utils';
import { withMysqlDatabase } from '@repo/test-utils/mysql-database';
import { describe } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  definePolicyEnforcementJourneys,
  type WithPolicyProject,
} from './utils/database-policies-enforcement';
import { setupPolicyProject } from './utils/database-policies-journey';
import { definePolicyMigrateJourneys } from './utils/database-policies-migrate';

withTempDir(({ createTempDir }) => {
  const onMysql: WithPolicyProject = async (test, fn) => {
    await withMysqlDatabase(test, ({ url }) =>
      fn(setupPolicyProject('mysql', createTempDir(), url)),
    );
  };

  describe('database policies (MySQL)', () => {
    definePolicyEnforcementJourneys(onMysql, timeouts.databaseOperation);
    definePolicyMigrateJourneys(onMysql, timeouts.databaseOperation);
  });
});
