/**
 * A contract change that changes the storage hash but needs no database operation (Postgres).
 *
 * `auth_users` is a table the application does not manage (`@@control(external)`): the planner plans nothing for it, but its columns are part of the contract's storage. Adding a column the table already has changes the storage hash and needs no operation.
 *
 * Journey N1 plans the change: `migration plan` writes a migration with no operations, names the table that changed, and `migrate` moves the marker to the new hash. Journey N2 applies the same change with `db update`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  readEmittedContractStorageHash,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const AUTH_USERS_SQL = 'CREATE TABLE public.auth_users (id integer PRIMARY KEY, email text)';

const FROM_PSL = `// use prisma-8

model User {
  id    Int    @id
  email String
}

model AuthUser {
  id Int @id

  @@map("auth_users")
  @@control(external)
}
`;

const TO_PSL = FROM_PSL.replace('  id Int @id\n\n', '  id    Int     @id\n  email String?\n\n');

interface NoOperationsPlan {
  readonly operations: readonly unknown[];
  readonly changedStorageEntities: readonly unknown[];
  readonly summary: string;
}

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

async function markerHash(connectionString: string): Promise<unknown> {
  const { rows } = await sql(
    connectionString,
    "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'",
  );
  return rows[0]?.['core_hash'];
}

withTempDir(({ createTempDir }) => {
  describe('Journey N1 (Postgres): migration plan writes a migration with no operations', () => {
    const db = useDevDatabase({ onReady: (cs) => sql(cs, AUTH_USERS_SQL) });

    it(
      'names the changed table, and migrate moves the marker to the new hash',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emitContract(ctx, FROM_PSL, 'N1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `N1.02: plan initial: ${initial.stderr}`).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'N1.03: migrate initial').toBe(0);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, TO_PSL, 'N1.04');

        const plan = await runMigrationPlan(ctx, ['--from', origin, '--name', 'email', '--json']);
        expect(plan.exitCode, `N1.05: plan: ${plan.stderr}`).toBe(0);
        expect(parseJsonOutput<NoOperationsPlan>(plan), 'N1.05: no operations').toMatchObject({
          operations: [],
          changedStorageEntities: [
            {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'table',
              entityName: 'auth_users',
            },
          ],
          summary: expect.stringContaining('What changed: table "public.auth_users".'),
        });
        const dir = join(ctx.testDir, 'migrations/app', latestMigrationDirName(ctx));
        expect(JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')), 'N1.05: ops.json').toEqual(
          [],
        );

        const applied = await runMigrate(ctx);
        expect(applied.exitCode, `N1.06: migrate: ${applied.stderr}`).toBe(0);
        expect(await markerHash(db.connectionString), 'N1.06: the marker').toBe(
          readEmittedContractStorageHash({ ...ctx, outputDir: ctx.testDir }),
        );
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `N1.07: db verify: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey N2 (Postgres): db update applies a change with no operations', () => {
    const db = useDevDatabase({ onReady: (cs) => sql(cs, AUTH_USERS_SQL) });

    it(
      'names the changed table and moves the marker to the new hash',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await emitContract(ctx, FROM_PSL, 'N2.01');
        const initial = await runDbUpdate(ctx);
        expect(initial.exitCode, `N2.02: db update initial: ${initial.stderr}`).toBe(0);
        await emitContract(ctx, TO_PSL, 'N2.03');

        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode, `N2.04: db update: ${update.stderr}`).toBe(0);
        expect(
          parseJsonOutput<Record<string, unknown>>(update),
          'N2.04: names the changed table',
        ).toMatchObject({
          plan: { operations: [] },
          changedStorageEntities: [
            {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'table',
              entityName: 'auth_users',
            },
          ],
          summary: expect.stringContaining('What changed: table "public.auth_users".'),
        });
        expect(await markerHash(db.connectionString), 'N2.04: the marker').toBe(
          readEmittedContractStorageHash({ ...ctx, outputDir: ctx.testDir }),
        );
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `N2.05: db verify: ${verify.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
