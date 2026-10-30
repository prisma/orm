/**
 * Database policies on MongoDB: a database whose change policy permits only migrations refuses
 * `db update`, its dry run and `db sign`; a database with no marker is still signed; ref writers
 * keep what a ref declares; a database with no policies behaves as before; and a run that fails on
 * its second migration leaves the recorded policies as they were.
 */

import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  definePolicyEnforcementJourneys,
  type WithPolicyProject,
} from './utils/database-policies-enforcement';
import {
  appMarker,
  errorOf,
  MIGRATE_ONLY_DECLARED,
  planTo,
  setupPolicyProject,
  writePolicyRef,
} from './utils/database-policies-journey';
import { runMigrate } from './utils/journey-test-helpers';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let databases = 0;

function nextDatabaseUrl(): { readonly url: string; readonly name: string } {
  databases += 1;
  const name = `policies_${Date.now()}_${databases}`;
  const url = new URL(replSet.getUri());
  url.pathname = `/${name}`;
  return { url: url.toString(), name };
}

withTempDir(({ createTempDir }) => {
  describe('database policies (MongoDB)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();
    }, timeouts.spinUpMongoMemoryServer);

    afterAll(async () => {
      await client?.close().catch(() => {});
      await replSet?.stop().catch(() => {});
    }, timeouts.spinUpMongoMemoryServer);

    const onMongo: WithPolicyProject = (_test, fn) =>
      fn(setupPolicyProject('mongo', createTempDir(), nextDatabaseUrl().url));

    definePolicyEnforcementJourneys(onMongo, timeouts.spinUpMongoMemoryServer);

    it('leaves the recorded policies as they were when the second of two migrations fails', async () => {
      const { url, name } = nextDatabaseUrl();
      const project = setupPolicyProject('mongo', createTempDir(), url);
      const base = await planTo(project, 'base', 'initial');
      expect((await runMigrate(project.ctx)).exitCode).toBe(0);
      await writePolicyRef(project, 'production', base, {
        dataProtection: { dataLoss: 'data-loss-permitted' },
      });
      const recorded = await runMigrate(project.ctx, [
        '--to',
        'production',
        '--permit-policy-change',
      ]);
      expect(recorded.exitCode, `${recorded.stdout}\n${recorded.stderr}`).toBe(0);
      await client
        .db(name)
        .collection('users')
        .insertMany([{ email: 'a@x.io' }, { email: 'a@x.io' }]);
      await planTo(project, 'next', 'add-name');
      const unique = await planTo(project, 'unique', 'unique-email');
      await writePolicyRef(project, 'production', unique, MIGRATE_ONLY_DECLARED);

      const failed = await runMigrate(project.ctx, [
        '--to',
        'production',
        '--permit-policy-change',
        '--json',
      ]);

      expect(errorOf(failed)).toMatchObject({
        why: expect.stringContaining('E11000 duplicate key'),
      });
      const marker = await appMarker(project);
      expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
        storageHash: base,
        meta: {
          policies: {
            change: ['migrate', 'reconcile'],
            dataProtection: {
              dataLoss: 'data-loss-permitted',
              accessWidening: 'access-widening-with-consent',
            },
          },
        },
      });
    });
  });
});
