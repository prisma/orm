/**
 * The data protection policy's `dataLoss` setting on MongoDB: `db update` refuses, asks or proceeds
 * under its three levels; `db migrate` refuses a recorded migration that drops a field under
 * `data-loss-forbidden`; `--permit-policy-change` loosens or tightens it; and `migration plan --to
 * <ref>` refuses a plan the ref forbids.
 */

import { timeouts } from '@repo/test-utils';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { definePolicyDataLossJourneys } from './utils/database-policies-data-loss';
import type { WithPolicyProject } from './utils/database-policies-enforcement';
import { setupPolicyProject } from './utils/database-policies-journey';

let replSet: MongoMemoryReplSet;
let databases = 0;

function nextDatabaseUrl(): string {
  databases += 1;
  const url = new URL(replSet.getUri());
  url.pathname = `/data_loss_${Date.now()}_${databases}`;
  return url.toString();
}

withTempDir(({ createTempDir }) => {
  describe('data protection, data loss (MongoDB)', {
    timeout: timeouts.spinUpMongoMemoryServer,
  }, () => {
    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      await replSet?.stop().catch(() => {});
    }, timeouts.spinUpMongoMemoryServer);

    const onMongo: WithPolicyProject = (_test, fn) =>
      fn(setupPolicyProject('mongo', createTempDir(), nextDatabaseUrl()));

    definePolicyDataLossJourneys(onMongo, timeouts.spinUpMongoMemoryServer);
  });
});
