import paradedb from '@internal/extension-paradedb/control';
import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import { planMigrationAndSelfEmit } from './utils/journey-test-helpers';

/**
 * Each extension pack's contract declares its extension, so `db sign` adopts a database that has the extension without running a migration, and a database on the pack's old head, whose marker records the old install invariant, moves to the new head with `db migrate`.
 *
 * PGlite ships `vector` but not `postgis` or `pg_search`. For those two the test records the extension in `pg_extension` directly, which is all that verification and the migration's checks read. That row proves nothing about a real install, such as PostGIS's `geometry` type or ParadeDB's `bm25` access method, and PGlite cannot run their `CREATE EXTENSION`, so for them the upgrade migration is shown to attempt it and fail.
 */

const JOURNEY_TIMEOUT = timeouts.spinUpPpgDev + timeouts.typeScriptCompilation;

interface PackCase {
  readonly title: string;
  readonly descriptor: SqlControlExtensionDescriptor<'postgres'>;
  readonly importPath: string;
  readonly extension: string;
  readonly installedByPglite: boolean;
}

const packs: readonly PackCase[] = [
  {
    title: 'the pgvector pack',
    descriptor: pgvector,
    importPath: '@internal/extension-pgvector/control',
    extension: 'vector',
    installedByPglite: true,
  },
  {
    title: 'the postgis pack, with the extension only as a pg_extension row',
    descriptor: postgis,
    importPath: '@internal/extension-postgis/control',
    extension: 'postgis',
    installedByPglite: false,
  },
  {
    title: 'the paradedb pack, with the extension only as a pg_extension row',
    descriptor: paradedb,
    importPath: '@internal/extension-paradedb/control',
    extension: 'pg_search',
    installedByPglite: false,
  },
];

function contractSpaceOf(pack: PackCase) {
  const space = pack.descriptor.contractSpace;
  if (space === undefined) throw new Error(`${pack.descriptor.id} declares no contract space`);
  return space;
}

function oldHeadOf(pack: PackCase): { readonly hash: string; readonly invariant: string } {
  const install = contractSpaceOf(pack).migrations.find(
    (m) => m.metadata.from === null && m.metadata.providedInvariants.length > 0,
  );
  const invariant = install?.metadata.providedInvariants[0];
  if (install === undefined || invariant === undefined) {
    throw new Error(`${pack.descriptor.id} has no old install migration`);
  }
  return { hash: install.metadata.to, invariant };
}

async function prepareDatabase(connectionString: string, pack: PackCase): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query(
      'CREATE TABLE "user" (id integer NOT NULL, email text NOT NULL, PRIMARY KEY (id))',
    );
    if (pack.installedByPglite) {
      await client.query(`CREATE EXTENSION ${pack.extension}`);
      return;
    }
    await client.query('SET allow_system_table_mods = on');
    await client.query(
      `INSERT INTO pg_catalog.pg_extension (oid, extname, extowner, extnamespace, extrelocatable, extversion)
       VALUES ((SELECT max(oid)::int + 100000 FROM pg_catalog.pg_extension)::oid, $1, 10, 'public'::regnamespace, false, '1.0')`,
      [pack.extension],
    );
  });
}

function upgradeMigrationOf(pack: PackCase): string {
  const oldHead = oldHeadOf(pack);
  const upgrade = contractSpaceOf(pack).migrations.find((m) => m.metadata.from === oldHead.hash);
  if (upgrade === undefined) throw new Error(`${pack.descriptor.id} has no upgrade migration`);
  return upgrade.dirName;
}

async function removeExtension(connectionString: string, pack: PackCase): Promise<void> {
  await withClient(connectionString, async (client) => {
    if (pack.installedByPglite) {
      await client.query(`DROP EXTENSION ${pack.extension}`);
      return;
    }
    await client.query('SET allow_system_table_mods = on');
    await client.query('DELETE FROM pg_catalog.pg_extension WHERE extname = $1', [pack.extension]);
  });
}

async function installedExtensions(connectionString: string): Promise<readonly string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query('SELECT extname FROM pg_catalog.pg_extension');
    return result.rows.map((row) => row.extname);
  });
}

async function appliedMigrations(connectionString: string, spaceId: string): Promise<string[]> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT migration_name FROM prisma_contract.ledger WHERE space = $1 ORDER BY id',
      [spaceId],
    );
    return result.rows.map((row) => row.migration_name);
  });
}

async function markers(
  connectionString: string,
): Promise<Record<string, { readonly hash: string; readonly invariants: readonly string[] }>> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      'SELECT space, core_hash, invariants FROM prisma_contract.marker ORDER BY space',
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.space, { hash: row.core_hash, invariants: row.invariants }]),
    );
  });
}

withTempDir(({ createTempDir }) => {
  describe.each(packs)('$title', (pack) => {
    const spaceId = pack.descriptor.id;
    const headHash = contractSpaceOf(pack).headRef.hash;

    async function setUpProject(connectionString: string) {
      const project = setupTestDirectoryFromFixtures(
        createTempDir,
        'extension-packs',
        'prisma.config.with-db.ts',
        { '{{DB_URL}}': connectionString, '@internal/extension-pgvector/control': pack.importPath },
      );
      const emit = await runOnEngine(project, ['contract', 'emit']);
      expect(emit.exitCode, `contract emit: ${emit.stderr}`).toBe(0);
      await prepareDatabase(connectionString, pack);
      return project;
    }

    it(
      'signs a database that lists the extension and has no marker, which then verifies strictly',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await setUpProject(connectionString);

          const sign = await runOnEngine(project, ['db', 'sign']);
          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
          expect((await markers(connectionString))[spaceId]).toEqual({
            hash: headHash,
            invariants: [],
          });

          const verify = await runOnEngine(project, ['db', 'verify', '--strict']);
          expect(verify.exitCode, `db verify --strict: ${verify.stderr}`).toBe(0);
        });
      },
      JOURNEY_TIMEOUT,
    );

    async function setUpOnOldHead(connectionString: string) {
      const project = await setUpProject(connectionString);
      const plan = await planMigrationAndSelfEmit(project, ['--name', 'init']);
      expect(plan.exitCode, `migration plan: ${plan.stderr}`).toBe(0);
      const sign = await runOnEngine(project, ['db', 'sign']);
      expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(0);
      const oldHead = oldHeadOf(pack);
      await withClient(connectionString, (client) =>
        client.query(
          'UPDATE prisma_contract.marker SET core_hash = $1, invariants = $2::text[] WHERE space = $3',
          [oldHead.hash, [oldHead.invariant], spaceId],
        ),
      );
      return project;
    }

    it(
      'moves a database on the old head that has the extension to the new head with db migrate',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = await setUpOnOldHead(connectionString);

          const migrate = await runOnEngine(project, ['db', 'migrate']);
          expect(migrate.exitCode, `db migrate: ${migrate.stderr}`).toBe(0);
          expect((await markers(connectionString))[spaceId]).toEqual({
            hash: headHash,
            invariants: [oldHeadOf(pack).invariant],
          });
          expect(await appliedMigrations(connectionString, spaceId)).toEqual([
            upgradeMigrationOf(pack),
          ]);

          const verify = await runOnEngine(project, ['db', 'verify', '--strict']);
          expect(verify.exitCode, `db verify --strict: ${verify.stderr}`).toBe(0);
        });
      },
      JOURNEY_TIMEOUT,
    );

    if (pack.installedByPglite) {
      it(
        'creates the extension when db migrate moves a database on the old head that lacks it',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const project = await setUpOnOldHead(connectionString);
            await removeExtension(connectionString, pack);

            const migrate = await runOnEngine(project, ['db', 'migrate']);
            expect(migrate.exitCode, `db migrate: ${migrate.stderr}`).toBe(0);
            expect(await installedExtensions(connectionString)).toContain(pack.extension);
            expect((await markers(connectionString))[spaceId]).toEqual({
              hash: headHash,
              invariants: [oldHeadOf(pack).invariant],
            });
            expect(await appliedMigrations(connectionString, spaceId)).toEqual([
              upgradeMigrationOf(pack),
            ]);

            const verify = await runOnEngine(project, ['db', 'verify', '--strict']);
            expect(verify.exitCode, `db verify --strict: ${verify.stderr}`).toBe(0);
          });
        },
        JOURNEY_TIMEOUT,
      );
    } else {
      it(
        'runs CREATE EXTENSION when db migrate moves a database on the old head that lacks it, which PGlite cannot install',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const project = await setUpOnOldHead(connectionString);
            await removeExtension(connectionString, pack);

            const migrate = await runOnEngine(project, ['db', 'migrate']);
            expect(migrate.exitCode).not.toBe(0);
            expect(`${migrate.stdout}${migrate.stderr}`).toContain(
              `extension "${pack.extension}" is not available`,
            );
            expect((await markers(connectionString))[spaceId]?.hash).toBe(oldHeadOf(pack).hash);
          });
        },
        JOURNEY_TIMEOUT,
      );
    }
  });
});
