/**
 * Prisma's own tables on PostgreSQL, through the commands.
 *
 * A database a release candidate of Prisma 8 set up keeps Prisma's tables in the schema
 * `prisma_contract`. Every command that changes a database renames it to `_prisma` and writes the
 * `_prisma` space's rows before it reads anything; a command that only reads, and a dry run, say an
 * earlier release wrote the tables and change nothing. The release candidate's tables are built
 * from the statements it ran, copied as text, and its rows as it would have written them after
 * applying one migration, so nothing here depends on today's code for the old form.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRISMA_SPACE_ID } from '@prisma/orm-framework/components/control';
import postgresTargetDescriptor from '@prisma/orm-postgres/target/control';
import { describe, expect, it } from 'vitest';
import { releaseCandidatePrismaTables } from '../../../../packages/3-targets/postgres/2-adapter/test/migrations/fixtures/release-candidate-prisma-tables';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  appMigrationsDir,
  EMPTY_CONTRACT_HASH,
  engineError,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationLog,
  runMigrationStatus,
  setupJourney,
  sql,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA_TABLES_HEAD = postgresTargetDescriptor.contractSpace!.headRef.hash;
const FIRST_PRISMA_TABLES_MIGRATION =
  postgresTargetDescriptor.contractSpace!.migrations[0]!.dirName;
const PRISMA_SPACE_BEHIND = 'CONTRACT.PRISMA_SPACE_BEHIND';
const UPGRADE_INSTRUCTIONS =
  'https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app';
const BROUGHT_UP_TO_DATE = "Prisma's own tables in this database were brought up to date.";
/** A space key in a command's JSON output that names the Prisma space. */
const LISTS_PRISMA_SPACE = /"(space|spaceId|id)":\s*"_prisma"/;

interface WrittenMigration {
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly migrationHash: string;
  readonly ops: readonly {
    readonly execute?: readonly { readonly sql: string; readonly params?: readonly unknown[] }[];
  }[];
}

function readMigration(ctx: JourneyContext, dirName: string): WrittenMigration {
  const dir = join(appMigrationsDir(ctx), dirName);
  const metadata = JSON.parse(readFileSync(join(dir, 'migration.json'), 'utf-8'));
  return {
    dirName,
    from: metadata.from,
    to: metadata.to,
    migrationHash: metadata.migrationHash,
    ops: JSON.parse(readFileSync(join(dir, 'ops.json'), 'utf-8')),
  };
}

function emittedProfileHash(ctx: JourneyContext): string {
  const contract = JSON.parse(readFileSync(join(ctx.outputDir, 'contract.json'), 'utf-8'));
  return contract.profileHash;
}

/**
 * The database a release candidate left after `db migrate` applied `migration`: its tables, the
 * migration's statements, and the marker and ledger rows it wrote in `prisma_contract`.
 */
async function buildReleaseCandidateDatabase(
  connectionString: string,
  ctx: JourneyContext,
  migration: WrittenMigration,
): Promise<void> {
  for (const statement of releaseCandidatePrismaTables) {
    await sql(connectionString, statement);
  }
  for (const operation of migration.ops) {
    for (const step of operation.execute ?? []) {
      await sql(connectionString, step.sql, [...(step.params ?? [])]);
    }
  }
  await sql(
    connectionString,
    `INSERT INTO prisma_contract.marker (space, core_hash, profile_hash) VALUES ('app', $1, $2)`,
    [migration.to, emittedProfileHash(ctx)],
  );
  await sql(
    connectionString,
    `INSERT INTO prisma_contract.ledger
       (space, migration_name, migration_hash, origin_core_hash, destination_core_hash, operations)
     VALUES ('app', $1, $2, $3, $4, $5::jsonb)`,
    [
      migration.dirName,
      migration.migrationHash,
      migration.from ?? EMPTY_CONTRACT_HASH,
      migration.to,
      JSON.stringify(migration.ops),
    ],
  );
}

async function schemas(connectionString: string): Promise<readonly unknown[]> {
  const result = await sql(
    connectionString,
    `SELECT nspname AS name FROM pg_namespace WHERE nspname IN ('_prisma', 'prisma_contract') ORDER BY 1`,
  );
  return result.rows.map((row) => row['name']);
}

async function markers(connectionString: string) {
  const result = await sql(
    connectionString,
    'SELECT space, core_hash FROM _prisma.marker ORDER BY space',
  );
  return result.rows;
}

async function ledger(connectionString: string) {
  const result = await sql(
    connectionString,
    'SELECT space, migration_name, origin_core_hash, destination_core_hash FROM _prisma.ledger ORDER BY id',
  );
  return result.rows;
}

async function userColumns(connectionString: string): Promise<readonly unknown[]> {
  const result = await sql(
    connectionString,
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user' ORDER BY 1`,
  );
  return result.rows.map((row) => row['column_name']);
}

/** Emits the base contract, writes the first migration, and builds the database a release candidate left after applying it. */
async function releaseCandidateProject(
  connectionString: string,
  createTempDir: () => string,
): Promise<{ readonly ctx: JourneyContext; readonly first: WrittenMigration }> {
  const ctx = setupJourney({ connectionString, createTempDir });
  expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
  expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode, 'plan').toBe(0);
  const first = readMigration(ctx, latestMigrationDirName(ctx));
  await buildReleaseCandidateDatabase(connectionString, ctx, first);
  return { ctx, first };
}

withTempDir(({ createTempDir }) => {
  describe('db migrate on a database a release candidate set up', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, keeps every row, applies the pending migration from where the database is, and changes nothing on a second run',
      async () => {
        const { ctx, first } = await releaseCandidateProject(db.connectionString, createTempDir);
        swapContract(ctx, 'contract-additive');
        expect((await runContractEmit(ctx)).exitCode, 'emit additive').toBe(0);
        const planned = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'add-name',
          '--from',
          first.dirName,
        ]);
        expect(planned.exitCode, 'plan second').toBe(0);
        const second = readMigration(ctx, latestMigrationDirName(ctx));

        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `db migrate: ${migrate.stderr}`).toBe(0);
        expect(migrate.stderr).toContain(BROUGHT_UP_TO_DATE);

        const expectedLedger = [
          {
            space: 'app',
            migration_name: first.dirName,
            origin_core_hash: EMPTY_CONTRACT_HASH,
            destination_core_hash: first.to,
          },
          {
            space: PRISMA_SPACE_ID,
            migration_name: FIRST_PRISMA_TABLES_MIGRATION,
            origin_core_hash: EMPTY_CONTRACT_HASH,
            destination_core_hash: PRISMA_TABLES_HEAD,
          },
          {
            space: 'app',
            migration_name: second.dirName,
            origin_core_hash: first.to,
            destination_core_hash: second.to,
          },
        ];
        const expectedState = {
          schemas: ['_prisma'],
          markers: [
            { space: PRISMA_SPACE_ID, core_hash: PRISMA_TABLES_HEAD },
            { space: 'app', core_hash: second.to },
          ],
          ledger: expectedLedger,
          userColumns: ['email', 'id', 'name'],
        };
        const state = async () => ({
          schemas: await schemas(db.connectionString),
          markers: await markers(db.connectionString),
          ledger: await ledger(db.connectionString),
          userColumns: await userColumns(db.connectionString),
        });
        expect(await state()).toEqual(expectedState);

        const again = await runMigrate(ctx);
        expect(again.exitCode, `second db migrate: ${again.stderr}`).toBe(0);
        expect(again.stderr).not.toContain(BROUGHT_UP_TO_DATE);
        expect(await state()).toEqual(expectedState);

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify: ${verify.stderr}`).toBe(0);

        const log = await runMigrationLog(ctx, ['--json']);
        expect(log.exitCode, 'migration log').toBe(0);
        expect(
          parseJsonOutput<{ records: { space: string; name: string }[] }>(log).records.map(
            ({ space, name }) => ({ space, name }),
          ),
        ).toEqual([
          { space: 'app', name: first.dirName },
          { space: 'app', name: second.dirName },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('commands that only read, on a database a release candidate set up', () => {
    const db = useDevDatabase();

    it(
      'say the tables are not up to date, name db migrate, and change nothing, even when db verify checks only the schema',
      async () => {
        const { ctx } = await releaseCandidateProject(db.connectionString, createTempDir);

        const verify = await runDbVerify(ctx, ['--json']);
        const verifySchemaOnly = await runDbVerify(ctx, ['--schema-only', '--json']);
        const status = await runMigrationStatus(ctx, ['--json']);
        const log = await runMigrationLog(ctx, ['--json']);
        const initDryRun = await runDbInit(ctx, ['--dry-run', '--json']);
        const updateDryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        const migrateShow = await runMigrate(ctx, ['--show', '--json']);

        for (const [name, run] of Object.entries({
          verify,
          verifySchemaOnly,
          status,
          log,
          initDryRun,
          updateDryRun,
          migrateShow,
        })) {
          expect(engineError(run), name).toMatchObject({
            code: PRISMA_SPACE_BEHIND,
            nextActions: [
              expect.objectContaining({
                kind: 'run-command',
                command: expect.stringContaining('db migrate'),
              }),
            ],
          });
        }
        expect(await schemas(db.connectionString)).toEqual(['prisma_contract']);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update on a database a release candidate set up', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, keeps the rows, and updates the database from where it is',
      async () => {
        const { ctx, first } = await releaseCandidateProject(db.connectionString, createTempDir);
        swapContract(ctx, 'contract-additive');
        expect((await runContractEmit(ctx)).exitCode, 'emit additive').toBe(0);

        const update = await runDbUpdate(ctx);
        expect(update.exitCode, `db update: ${update.stderr}`).toBe(0);

        expect({
          schemas: await schemas(db.connectionString),
          spaces: (await markers(db.connectionString)).map((row) => row['space']),
          firstLedgerRow: (await ledger(db.connectionString))[0],
          userColumns: await userColumns(db.connectionString),
        }).toEqual({
          schemas: ['_prisma'],
          spaces: [PRISMA_SPACE_ID, 'app'],
          firstLedgerRow: {
            space: 'app',
            migration_name: first.dirName,
            origin_core_hash: EMPTY_CONTRACT_HASH,
            destination_core_hash: first.to,
          },
          userColumns: ['email', 'id', 'name'],
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db sign on a database a release candidate set up', () => {
    const db = useDevDatabase();

    it(
      'renames the schema and keeps the application row',
      async () => {
        const { ctx, first } = await releaseCandidateProject(db.connectionString, createTempDir);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);

        expect({
          schemas: await schemas(db.connectionString),
          markers: await markers(db.connectionString),
        }).toEqual({
          schemas: ['_prisma'],
          markers: [
            { space: PRISMA_SPACE_ID, core_hash: PRISMA_TABLES_HEAD },
            { space: 'app', core_hash: first.to },
          ],
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db init on a new database', () => {
    const db = useDevDatabase();

    it(
      "creates Prisma's tables in _prisma, and later commands find nothing wrong with their row",
      async () => {
        const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });
        expect((await runContractEmit(ctx)).exitCode, 'emit').toBe(0);

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init: ${init.stderr}`).toBe(0);
        expect({
          schemas: await schemas(db.connectionString),
          spaces: (await markers(db.connectionString)).map((row) => row['space']),
          prismaLedger: (await ledger(db.connectionString)).filter(
            (row) => row['space'] === PRISMA_SPACE_ID,
          ),
        }).toEqual({
          schemas: ['_prisma'],
          spaces: [PRISMA_SPACE_ID, 'app'],
          prismaLedger: [
            {
              space: PRISMA_SPACE_ID,
              migration_name: FIRST_PRISMA_TABLES_MIGRATION,
              origin_core_hash: EMPTY_CONTRACT_HASH,
              destination_core_hash: PRISMA_TABLES_HEAD,
            },
          ],
        });

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify: ${verify.stderr}`).toBe(0);
        const strict = await runDbVerify(ctx, ['--strict']);
        expect(strict.exitCode, `db verify --strict: ${strict.stderr}`).toBe(0);
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, `db update: ${update.stderr}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db init on a database a release candidate set up', () => {
    const db = useDevDatabase();

    it(
      'renames the schema, keeps the application row, and says so',
      async () => {
        const { ctx, first } = await releaseCandidateProject(db.connectionString, createTempDir);

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init: ${init.stderr}`).toBe(0);

        expect({
          broughtUpToDate: init.stderr.includes(BROUGHT_UP_TO_DATE),
          schemas: await schemas(db.connectionString),
          markers: await markers(db.connectionString),
        }).toEqual({
          broughtUpToDate: true,
          schemas: ['_prisma'],
          markers: [
            { space: PRISMA_SPACE_ID, core_hash: PRISMA_TABLES_HEAD },
            { space: 'app', core_hash: first.to },
          ],
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('a database whose tables are in a form from before the release candidates', () => {
    const db = useDevDatabase();

    it(
      'stops db migrate with an error that names the table and points at the upgrade instructions, and changes nothing',
      async () => {
        const { ctx } = await releaseCandidateProject(db.connectionString, createTempDir);
        await sql(db.connectionString, 'ALTER TABLE prisma_contract.marker DROP COLUMN app_tag');

        const migrate = await runMigrate(ctx, ['--json']);

        expect(migrate.exitCode).not.toBe(0);
        expect(engineError(migrate)).toMatchObject({
          code: 'MIGRATION.PRECHECK_FAILED',
          summary: "Prisma's own tables in this database could not be brought up to date",
          why: expect.stringContaining('"prisma_contract"."marker"'),
          fix: expect.stringContaining(UPGRADE_INSTRUCTIONS),
          nextActions: [expect.objectContaining({ kind: 'open-url', url: UPGRADE_INSTRUCTIONS })],
        });
        expect(await schemas(db.connectionString)).toEqual(['prisma_contract']);
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'stops db sign the same way',
      async () => {
        const { ctx } = await releaseCandidateProject(db.connectionString, createTempDir);
        await sql(
          db.connectionString,
          'ALTER TABLE prisma_contract.ledger ALTER COLUMN operations DROP NOT NULL',
        );

        const sign = await runDbSign(ctx, ['--json']);

        expect(sign.exitCode).not.toBe(0);
        expect(engineError(sign)).toMatchObject({
          code: 'MIGRATION.PRECHECK_FAILED',
          why: expect.stringContaining('"prisma_contract"."ledger"'),
          fix: expect.stringContaining(UPGRADE_INSTRUCTIONS),
        });
        expect(await schemas(db.connectionString)).toEqual(['prisma_contract']);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('commands that list spaces, on a database that has the Prisma space', () => {
    const db = useDevDatabase();

    it(
      'do not list it',
      async () => {
        const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });
        expect((await runContractEmit(ctx)).exitCode, 'emit').toBe(0);
        expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode, 'plan').toBe(
          0,
        );
        const migrate = await runMigrate(ctx, ['--json']);
        expect(migrate.exitCode, `db migrate: ${migrate.stderr}`).toBe(0);
        const sign = await runDbSign(ctx, ['--json']);
        expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
        const status = await runMigrationStatus(ctx, ['--json']);
        expect(status.exitCode, `migration status: ${status.stderr}`).toBe(0);

        expect((await markers(db.connectionString)).map((row) => row['space'])).toEqual([
          PRISMA_SPACE_ID,
          'app',
        ]);
        expect({
          migrate: LISTS_PRISMA_SPACE.test(migrate.stdout),
          sign: LISTS_PRISMA_SPACE.test(sign.stdout),
          status: LISTS_PRISMA_SPACE.test(status.stdout),
        }).toEqual({ migrate: false, sign: false, status: false });
        expect(sign.stdout).toMatch(/"(space|spaceId)":\s*"app"/);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
