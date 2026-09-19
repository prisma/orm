import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  migrationStatusAppSpace,
  parseJsonOutput,
  parseMigrationStatusJson,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runMigrationPlan,
  runMigrationStatus,
  setupJourney,
  swapPslContract,
} from './utils/journey-test-helpers';

const CREATE_USER_TABLE = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
`;

const ADD_NAME_COLUMN = `ALTER TABLE "user" ADD COLUMN name text;`;

interface PlanJson {
  readonly from: string | null;
  readonly to: string;
  readonly dir?: string;
  readonly baselineDir?: string;
  readonly operations: readonly { readonly id: string; readonly label: string }[];
}

interface SignJson {
  readonly ok: boolean;
  readonly contract: { readonly storageHash: string };
  readonly advancedRef: { readonly name: string; readonly hash: string } | null;
}

function emittedStorageHash(ctx: JourneyContext): string {
  const contractJson = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')) as {
    storage: { storageHash: string };
  };
  return contractJson.storage.storageHash;
}

function refsDir(ctx: JourneyContext): string {
  return join(ctx.testDir, 'migrations', 'app', 'refs');
}

function refHash(ctx: JourneyContext, name: string): string | undefined {
  const pointerPath = join(refsDir(ctx), `${name}.json`);
  if (!existsSync(pointerPath)) return undefined;
  return (JSON.parse(readFileSync(pointerPath, 'utf-8')) as { hash: string }).hash;
}

function snapshotExists(ctx: JourneyContext, hash: string): boolean {
  const storeDir = contractSnapshotDir(join(ctx.testDir, 'migrations'), hash);
  return (
    existsSync(join(storeDir, 'contract.json')) &&
    existsSync(join(storeDir, 'contract.d.ts')) &&
    statSync(join(storeDir, 'contract.json')).size > 0
  );
}

/**
 * An adopting user's starting point: a database created by hand, a PSL
 * contract inferred from it, and the contract emitted.
 */
async function setupInferredProject(
  connectionString: string,
  createTempDir: () => string,
): Promise<JourneyContext> {
  await withClient(connectionString, (client) => client.query(CREATE_USER_TABLE));
  const ctx = setupJourney({ connectionString, createTempDir, contractMode: 'psl' });
  const infer = await runContractInfer(ctx);
  expect(infer.exitCode, stripAnsi(infer.stderr)).toBe(0);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);
  return ctx;
}

async function signJson(ctx: JourneyContext, extraArgs: readonly string[] = []): Promise<SignJson> {
  const sign = await runDbSign(ctx, [...extraArgs, '--json']);
  expect(sign.exitCode, stripAnsi(sign.stderr)).toBe(0);
  return parseJsonOutput<SignJson>(sign);
}

withTempDir(({ createTempDir }) => {
  describe('db sign advances the db ref (e2e)', () => {
    it(
      'adoption: the next migration plan chains from the signed contract',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const signedHash = emittedStorageHash(ctx);

          const signed = await signJson(ctx);
          expect(signed.advancedRef).toEqual({ name: 'db', hash: signedHash });
          expect(refHash(ctx, 'db')).toBe(signedHash);
          expect(snapshotExists(ctx, signedHash)).toBe(true);

          swapPslContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          const targetHash = emittedStorageHash(ctx);
          expect(targetHash).not.toBe(signedHash);

          const plan = await runMigrationPlan(ctx, ['--name', 'add-name', '--json']);
          expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);
          const planJson = parseJsonOutput<PlanJson>(plan);
          expect(planJson.from).toBe(signedHash);
          expect(planJson.to).toBe(targetHash);
          expect(planJson.baselineDir).toBeDefined();
          expect(planJson.operations).toHaveLength(1);
          expect(planJson.operations[0]?.label).toMatch(/name/);
          expect(planJson.operations.map((operation) => operation.label)).not.toContainEqual(
            expect.stringMatching(/create table/i),
          );
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances the db ref when --db is passed',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const signedHash = emittedStorageHash(ctx);

          const signed = await signJson(ctx, ['--db', connectionString]);

          expect(signed.advancedRef).toEqual({ name: 'db', hash: signedHash });
          expect(refHash(ctx, 'db')).toBe(signedHash);
          expect(snapshotExists(ctx, signedHash)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'migration status reports up to date after signing',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const signedHash = emittedStorageHash(ctx);
          await signJson(ctx);

          const status = await runMigrationStatus(ctx, ['--json']);
          expect(status.exitCode, stripAnsi(status.stderr)).toBe(0);
          const statusJson = parseMigrationStatusJson(status);
          const app = migrationStatusAppSpace(statusJson);
          expect(app).toEqual({
            space: 'app',
            currentContract: signedHash,
            targetContract: signedHash,
            migrations: [],
          });
          expect(statusJson.diagnostics ?? []).toEqual([]);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      're-signing at a newer hash moves the ref and names the previous hash',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const firstHash = emittedStorageHash(ctx);
          await signJson(ctx);

          await withClient(connectionString, (client) => client.query(ADD_NAME_COLUMN));
          swapPslContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);
          const secondHash = emittedStorageHash(ctx);
          expect(secondHash).not.toBe(firstHash);

          const resign = await runDbSign(ctx);
          expect(resign.exitCode, stripAnsi(resign.stderr)).toBe(0);

          expect(refHash(ctx, 'db')).toBe(secondHash);
          expect(snapshotExists(ctx, secondHash)).toBe(true);
          const output = stripAnsi(resign.stderr);
          expect(output).toContain(`Advanced ref "db"`);
          expect(output).toContain(secondHash);
          expect(output).toMatch(new RegExp(`was ${firstHash}`));
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--advance-ref writes the named ref and leaves db absent',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const signedHash = emittedStorageHash(ctx);

          const signed = await signJson(ctx, ['--advance-ref', 'staging']);

          expect(signed.advancedRef).toEqual({ name: 'staging', hash: signedHash });
          expect(refHash(ctx, 'staging')).toBe(signedHash);
          expect(refHash(ctx, 'db')).toBeUndefined();
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a refused signature writes no ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          swapPslContract(ctx, 'contract-additive');
          expect((await runContractEmit(ctx)).exitCode).toBe(0);

          const refused = await runDbSign(ctx);

          expect(refused.exitCode).toBe(4);
          expect(existsSync(refsDir(ctx))).toBe(false);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      '--no-advance-ref writes the marker but no ref and no snapshot',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const ctx = await setupInferredProject(connectionString, createTempDir);
          const signedHash = emittedStorageHash(ctx);

          const signed = await signJson(ctx, ['--no-advance-ref']);

          expect(signed.advancedRef).toBeNull();
          expect(existsSync(refsDir(ctx))).toBe(false);
          expect(snapshotExists(ctx, signedHash)).toBe(false);
          await withClient(connectionString, async (client) => {
            const result = await client.query(
              'select core_hash from prisma_contract.marker where space = $1',
              ['app'],
            );
            expect(result.rows).toHaveLength(1);
          });
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
