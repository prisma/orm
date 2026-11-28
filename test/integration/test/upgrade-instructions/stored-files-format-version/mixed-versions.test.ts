import { readFileSync } from 'node:fs';
import { loadContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import { readContractSnapshotJson } from '@internal/migration-tools/contract-snapshot-store';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { copyFixture, fixturesDir, readTree, removeWorkDirs, writeFile } from './test-helpers';

afterAll(removeWorkDirs);

const SNAPSHOT =
  'app/migrations/snapshots/ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3/contract.json';

const UPGRADED_BY_HAND = [
  'app/src/prisma/contract.json',
  'app/migrations/app/20260601T1347_contract_hash_advance/migration.json',
  'app/migrations/app/refs/production.json',
  'app/migrations/snapshots/269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6/contract.json',
];

function mixedProject(): string {
  const root = copyFixture('before');
  for (const path of UPGRADED_BY_HAND) {
    writeFile(root, path, readFileSync(join(fixturesDir, 'after', path), 'utf8'));
  }
  return root;
}

async function loaded(root: string) {
  const serializer = new PostgresContractSerializer();
  const appContract = serializer.deserializeContract(
    JSON.parse(readFileSync(join(root, 'app/src/prisma/contract.json'), 'utf8')),
  );
  const aggregate = await loadContractSpaceAggregate({
    migrationsDir: join(root, 'app/migrations'),
    deserializeContract: (raw) => serializer.deserializeContract(raw),
    appContract,
  });
  const project = {
    appContract,
    packages: aggregate.app.packages,
    refs: aggregate.app.refs,
    edges: [...aggregate.app.graph().migrationByHash.keys()].sort(),
    violations: aggregate.checkIntegrity(),
    snapshot: await readContractSnapshotJson(
      join(root, 'app/migrations'),
      'ab4b37f4e30e5935f5e9dc3b6cffb6fca4827e975950a41dfe30a10ed89f5cc3',
    ),
  };
  return JSON.parse(JSON.stringify(project).replaceAll(root, '<project>'));
}

describe('a project whose every file a release candidate wrote', () => {
  it('loads as the same project as one whose every file the format script upgraded', async () => {
    expect(await loaded(copyFixture('before'))).toEqual(await loaded(copyFixture('after')));
  });
});

describe('a project that holds files in both format versions', () => {
  it('loads as the same project as one whose every file the format script upgraded', async () => {
    const root = mixedProject();
    const mixed = await loaded(root);
    expect(mixed).toEqual(await loaded(copyFixture('after')));
    expect(mixed.packages.length).toBeGreaterThan(0);
    expect(mixed.snapshot).toEqual(
      JSON.parse(readFileSync(join(fixturesDir, 'after', SNAPSHOT), 'utf8')),
    );
  });

  it('leaves every file as it was', async () => {
    const root = mixedProject();
    const before = readTree(root);
    await loaded(root);
    expect(readTree(root)).toEqual(before);
  });
});
