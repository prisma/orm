/**
 * The data protection policy's `accessWidening` setting on PostgreSQL: `db update` refuses, asks or
 * proceeds under its three levels when a change disables row-level security and drops a policy;
 * `db migrate` refuses a recorded `disableRowLevelSecurity` and a recorded `dropRlsPolicy` under
 * `access-widening-forbidden`, and runs a migration that drops a policy and creates it again.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { AccessWideningLevel } from '@internal/framework-components/control';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  appMarker,
  errorOf,
  latestMigrationTo,
  type PolicyProject,
  setupPolicyProject,
  writePolicyRef,
} from './utils/database-policies-journey';
import {
  getLatestMigrationDir,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  sql,
} from './utils/journey-test-helpers';

const USER = (rls: boolean) => `  model User {
    id       Int @id
    tenantId Int @map("tenant_id")

    @@map("user")${rls ? '\n    @@rls' : ''}
  }
`;

const POLICY = (using: string) => `
  policy_select tenant_read {
    target = User
    roles  = [app_user]
    using  = sql\`${using}\`
  }
`;

const contract = (body: string) => `// use prisma-8

namespace public {
${body}}
`;

const WITH_POLICY = contract(`${USER(true)}${POLICY('(tenant_id = 1)')}`);
const CHANGED_POLICY = contract(`${USER(true)}${POLICY('(tenant_id = 2)')}`);
const RLS_ONLY = contract(USER(true));
const NO_RLS = contract(USER(false));

const FORBIDDEN = {
  code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
  summary: "This database's data protection policy forbids changing who can read or write rows",
};

async function emit(project: PolicyProject, psl: string): Promise<void> {
  writeFileSync(join(project.ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(project.ctx);
  expect(emitted.exitCode, `emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
}

/** Emits `psl` and plans a migration to it from the latest one, returning the contract it ends at. */
async function planTo(project: PolicyProject, psl: string, name: string): Promise<string> {
  const previous = getLatestMigrationDir(project.ctx);
  await emit(project, psl);
  const planned = await planMigrationAndSelfEmit(project.ctx, [
    '--name',
    name,
    ...(previous === undefined ? [] : ['--from', previous]),
  ]);
  expect(planned.exitCode, `plan ${name}: ${planned.stdout}\n${planned.stderr}`).toBe(0);
  return latestMigrationTo(project);
}

/** A database migrated to `psl`, recording `accessWidening` when given. */
async function migratedTo(
  project: PolicyProject,
  psl: string,
  accessWidening: AccessWideningLevel | undefined,
): Promise<string> {
  await sql(
    project.connection,
    'DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );
  const hash = await planTo(project, psl, 'initial');
  const migrated = await runMigrate(project.ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
  if (accessWidening !== undefined) {
    await writePolicyRef(project, 'production', hash, { dataProtection: { accessWidening } });
    const recorded = await runMigrate(project.ctx, [
      '--to',
      'production',
      '--permit-policy-change',
    ]);
    expect(recorded.exitCode, `record: ${recorded.stdout}\n${recorded.stderr}`).toBe(0);
  }
  return hash;
}

async function policiesOnUser(project: PolicyProject): Promise<unknown> {
  const counted = await sql(
    project.connection,
    `SELECT count(*)::int AS policies FROM pg_policies WHERE tablename = 'user'`,
  );
  return counted.rows[0]?.['policies'];
}

function latestOps(project: PolicyProject): readonly { readonly id: string }[] {
  const dir = getLatestMigrationDir(project.ctx) ?? '';
  return JSON.parse(
    readFileSync(join(project.ctx.testDir, 'migrations', 'app', dir, 'ops.json'), 'utf-8'),
  );
}

withTempDir(({ createTempDir }) => {
  const withProject = (fn: (project: PolicyProject) => Promise<void>) =>
    withDevDatabase(({ connectionString }) =>
      fn(setupPolicyProject('postgres', createTempDir(), connectionString)),
    );

  describe('data protection, access widening (PostgreSQL)', () => {
    it(
      'db update under access-widening-forbidden refuses disabling row-level security and dropping a policy, even with --allow',
      async () => {
        await withProject(async (project) => {
          await migratedTo(project, WITH_POLICY, 'access-widening-forbidden');
          await emit(project, NO_RLS);

          const plain = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);
          const allowed = await runDbUpdate(project.ctx, ['--allow', 'User', '--json']);

          for (const refused of [plain, allowed]) {
            expect(errorOf(refused)).toMatchObject({
              ...FORBIDDEN,
              meta: {
                command: 'db update',
                settings: [{ setting: 'accessWidening', level: 'access-widening-forbidden' }],
              },
            });
          }
          const operationIds = (
            errorOf(allowed)['meta'] as { operations: { operationId: string }[] }
          ).operations.map(({ operationId }) => operationId);
          expect(operationIds).toEqual(
            expect.arrayContaining([
              'rowLevelSecurity.public.user.disable',
              expect.stringMatching(/^rlsPolicy\.public\.user\.tenant_read_[0-9a-f]{8}\.drop$/),
            ]),
          );
          expect(await policiesOnUser(project)).toBe(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db update under access-widening-with-consent asks before dropping a policy, so nobody answering refuses it, and --allow applies it',
      async () => {
        await withProject(async (project) => {
          await migratedTo(project, WITH_POLICY, undefined);
          await emit(project, RLS_ONLY);

          const unanswered = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);
          const allowed = await runDbUpdate(project.ctx, ['--allow', 'User', '--json']);

          expect(errorOf(unanswered)).toMatchObject({ code: 'CLI.CONSENT_REQUIRED' });
          expect(allowed.exitCode, `db update --allow: ${allowed.stdout}\n${allowed.stderr}`).toBe(
            0,
          );
          expect(await policiesOnUser(project)).toBe(0);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db update under access-widening-permitted applies the change without asking',
      async () => {
        await withProject(async (project) => {
          await migratedTo(project, WITH_POLICY, 'access-widening-permitted');
          await emit(project, NO_RLS);

          const applied = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);

          expect(applied.exitCode, `db update: ${applied.stdout}\n${applied.stderr}`).toBe(0);
          expect(await policiesOnUser(project)).toBe(0);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db migrate under access-widening-forbidden refuses a recorded disableRowLevelSecurity and changes nothing',
      async () => {
        await withProject(async (project) => {
          const hash = await migratedTo(project, RLS_ONLY, 'access-widening-forbidden');
          await planTo(project, NO_RLS, 'disable-rls');
          const migration = getLatestMigrationDir(project.ctx);
          const metaBefore = (await appMarker(project))?.meta;

          const refused = await runMigrate(project.ctx, ['--json']);

          expect(errorOf(refused)).toMatchObject({
            ...FORBIDDEN,
            meta: {
              command: 'db migrate',
              operations: [
                {
                  setting: 'accessWidening',
                  spaceId: 'app',
                  migration,
                  operationId: 'rowLevelSecurity.public.user.disable',
                  subject: 'public.user',
                },
              ],
            },
          });
          const marker = await appMarker(project);
          expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
            storageHash: hash,
            meta: metaBefore,
          });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db migrate under access-widening-forbidden refuses a recorded dropRlsPolicy and keeps the policy',
      async () => {
        await withProject(async (project) => {
          await migratedTo(project, WITH_POLICY, 'access-widening-forbidden');
          await planTo(project, RLS_ONLY, 'drop-policy');
          const migration = getLatestMigrationDir(project.ctx);

          const refused = await runMigrate(project.ctx, ['--json']);

          expect(errorOf(refused)).toMatchObject({
            ...FORBIDDEN,
            meta: {
              operations: [
                {
                  setting: 'accessWidening',
                  migration,
                  operationId: expect.stringMatching(/^rlsPolicy\.public\.user\..*\.drop$/),
                  subject: 'public.user',
                },
              ],
            },
          });
          expect(await policiesOnUser(project)).toBe(1);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db migrate under access-widening-forbidden runs a migration that drops a policy and creates it again',
      async () => {
        await withProject(async (project) => {
          await migratedTo(project, WITH_POLICY, 'access-widening-forbidden');
          const changed = await planTo(project, CHANGED_POLICY, 'change-policy');
          const ids = latestOps(project).map(({ id }) => id);

          const applied = await runMigrate(project.ctx, ['--json']);

          expect(ids).toEqual(
            expect.arrayContaining([
              expect.stringMatching(/^rlsPolicy\.public\.user\.tenant_read_[0-9a-f]{8}\.drop$/),
              expect.stringMatching(/^rlsPolicy\.public\.user\.tenant_read_[0-9a-f]{8}$/),
            ]),
          );
          expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
          expect({
            storageHash: (await appMarker(project))?.storageHash,
            policies: await policiesOnUser(project),
          }).toEqual({ storageHash: changed, policies: 1 });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
