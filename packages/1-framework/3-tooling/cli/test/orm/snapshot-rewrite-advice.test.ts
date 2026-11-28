import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  contractSnapshotDir,
  writeContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const CONTRACT = createSqlContract({
  target: 'postgres',
  storage: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: { user: { columns: { id: {} } } } },
      },
    },
  },
});
const HEAD = CONTRACT.storage.storageHash;
const DB_URL = 'postgres://localhost:1/unused';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function strictConfig(): Record<string, unknown> {
  const component = (kind: string, extra: Record<string, unknown>) => ({
    kind,
    familyId: 'sql',
    version: '1.0.0',
    create: () => ({}),
    ...extra,
  });
  return {
    family: component('family', {
      id: 'sql',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => {
          if (json !== null && typeof json === 'object' && 'zzz' in json) {
            throw new ContractValidationError('zzz must be removed', 'structural');
          }
          return json;
        },
      }),
    }),
    target: component('target', { id: 'postgres', targetId: 'postgres', migrations: {} }),
    adapter: component('adapter', { id: 'pg', targetId: 'postgres' }),
    driver: component('driver', { id: 'pg-driver', targetId: 'postgres' }),
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => CONTRACT },
      output: 'output/contract.json',
      typesModule: '@acme/orm-db/contract-types',
    },
    migrations: { module: '@acme/orm-db/migration' },
  };
}

/** A project whose emitted contract's snapshot holds a key the family refuses, and whose `db` ref names it. */
async function projectWithUnreadableHeadSnapshot(options: {
  readonly migrationEndsAtHead: boolean;
}): Promise<string> {
  const dir = createTestProjectDir('snapshot-rewrite-advice');
  dirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  const contractJson = { formatVersion: 1, ...CONTRACT };
  await mkdir(join(dir, 'output'), { recursive: true });
  await writeFile(join(dir, 'output', 'contract.json'), JSON.stringify(contractJson));
  await writeContractSnapshot(migrationsDir, HEAD, {
    contractJson,
    contractDts: 'export type Contract = never;\n',
  });
  const snapshotPath = join(contractSnapshotDir(migrationsDir, HEAD), 'contract.json');
  const stored = JSON.parse(await readFile(snapshotPath, 'utf-8'));
  await writeFile(snapshotPath, JSON.stringify({ ...stored, zzz: 1 }));
  await writeRef(join(migrationsDir, 'app', 'refs'), 'db', { hash: HEAD, invariants: [] });
  if (options.migrationEndsAtHead) {
    const ops = [
      blindCast<MigrationPlanOperation, 'the loader reads only the operation list'>({
        id: 'schema.add_column',
        label: 'Add column',
        operationClass: 'additive',
      }),
    ];
    const base = blindCast<Omit<MigrationMetadata, 'migrationHash'>, 'test metadata'>({
      from: null,
      to: HEAD,
      providedInvariants: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    await writeMigrationPackage(
      join(migrationsDir, 'app', '20250101T0000_initial'),
      { ...base, migrationHash: computeMigrationHash(base, ops) },
      ops,
    );
  }
  return dir;
}

async function rewriteAction(dir: string, args: readonly string[]): Promise<unknown> {
  const run = await createOrmTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    orm: strictConfig(),
  }).run([...args, '--json'], { cwd: dir });
  const last = blindCast<
    {
      readonly envelope?: {
        readonly error?: {
          readonly code?: string;
          readonly nextActions?: readonly { readonly kind: string }[];
        };
      };
    },
    'the last event of a refused run is its result envelope'
  >(run.json.at(-1));
  expect(last.envelope?.error).toMatchObject({ code: 'CONTRACT.VALIDATION_FAILED' });
  return last.envelope?.error?.nextActions?.find((action) => action.kind === 'run-command');
}

const MIGRATE_REWRITE = {
  kind: 'run-command',
  label: expect.stringMatching(
    new RegExp(
      `migrations/snapshots/${HEAD} and run this command, which applies any pending migrations to the configured database, then moves the db ref to contract\\.json and writes the snapshot again from it$`,
    ),
  ),
  command: 'prisma-test db migrate --advance-ref db',
};
const SIGN_REWRITE = {
  kind: 'run-command',
  label: expect.stringMatching(
    new RegExp(
      `migrations/snapshots/${HEAD} and run this command, which checks that the configured database matches contract\\.json and records that in the database, then moves the db ref to contract\\.json and writes the snapshot again from it$`,
    ),
  ),
  command: 'prisma-test db sign',
};

const MIGRATE_REWRITE_ON_GIVEN_DB = {
  kind: 'run-command',
  label: expect.stringMatching(
    new RegExp(
      `migrations/snapshots/${HEAD} and run this command, which applies any pending migrations to the database --db names, then moves the db ref to contract\\.json and writes the snapshot again from it$`,
    ),
  ),
  command: 'prisma-test db migrate --advance-ref db --db <url>',
};

describe('advice for the unreadable snapshot of the emitted contract', () => {
  it.each([
    ['db sign <ref>', ['db', 'sign', 'db', '--db', DB_URL]],
    ['db update --to', ['db', 'update', '--to', 'db', '--dry-run', '--db', DB_URL]],
  ])(
    "%s, which reads a ref's snapshot only when a migration ends there, names db migrate on the database --db names and says it applies pending migrations",
    async (_, args) => {
      const dir = await projectWithUnreadableHeadSnapshot({ migrationEndsAtHead: true });
      expect(await rewriteAction(dir, args)).toEqual(MIGRATE_REWRITE_ON_GIVEN_DB);
    },
  );

  it('migration plan, starting from the db ref when no migration ends at the contract, names db sign', async () => {
    const dir = await projectWithUnreadableHeadSnapshot({ migrationEndsAtHead: false });
    expect(await rewriteAction(dir, ['migration', 'plan', '--name', 'next'])).toEqual(SIGN_REWRITE);
  });

  it('migration plan, starting from the db ref when a migration ends at the contract, names db migrate', async () => {
    const dir = await projectWithUnreadableHeadSnapshot({ migrationEndsAtHead: true });
    expect(await rewriteAction(dir, ['migration', 'plan', '--name', 'next'])).toEqual(
      MIGRATE_REWRITE,
    );
  });
});
