import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import { normalizeSqlStorage } from '@internal/sql-contract/normal-form';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { copyDirectory, fixturesDir, readTree, removeWorkDirs, runScript } from './test-helpers';

afterAll(removeWorkDirs);

const NOTHING_CHANGED =
  'Every stored hash already has the value this release computes; nothing changed.\n';
const CONTRACT = 'src/prisma/contract.json';
const DTS = 'src/prisma/contract.d.ts';
const MIGRATIONS = 'migrations/app';
const releaseCandidateDir = join(
  import.meta.dirname,
  '../../release-candidate-projects/fixtures/8.0.0-rc.25',
);

function readJson(root: string, path: string) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function storageHashOf(root: string, path: string): string {
  const { storageHash: _storageHash, ...storage } = readJson(root, path).storage;
  return computeStorageHash({
    target: 'postgres',
    targetFamily: 'sql',
    storage,
    normalizeStorage: normalizeSqlStorage,
  });
}

function snapshotsOf(root: string): string[] {
  const dir = join(root, 'migrations/snapshots');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const noSnapshot = { snapshots: [], snapshotStorageHash: [] };

function profileLines(stdout: string): string[] {
  const lines = stdout.split('\n');
  const start = lines.indexOf('Profile hashes (old -> new):');
  if (start === -1) return [];
  const block = lines.slice(start + 1);
  const end = block.findIndex((line) => !line.startsWith('  '));
  return block.slice(0, end === -1 ? undefined : end).map((line) => line.trim());
}

function migrationOf(root: string): string {
  const [migration] = readdirSync(join(root, MIGRATIONS)).filter((name) => name !== 'refs');
  return `${MIGRATIONS}/${migration}`;
}

/** Where each file of the project names a storage hash. */
function namedStorageHashes(root: string) {
  const migration = migrationOf(root);
  return {
    snapshots: snapshotsOf(root),
    snapshotStorageHash: snapshotsOf(root).map(
      (hash) => readJson(root, `migrations/snapshots/${hash}/contract.json`).storage.storageHash,
    ),
    migrationTo: readJson(root, `${migration}/migration.json`).to,
    migrationTs: [
      ...new Set(
        readFileSync(join(root, `${migration}/migration.ts`), 'utf8').match(/[0-9a-f]{64}/g),
      ),
    ],
    ref: readJson(root, `${MIGRATIONS}/refs/db.json`).hash,
  };
}

function everywhere(hash: string) {
  return {
    snapshots: [hash],
    snapshotStorageHash: [hash],
    migrationTo: hash,
    migrationTs: [hash],
    ref: hash,
  };
}

describe.each([
  {
    project: 'postgres-emptied-value',
    holds: 'an index option `fastupdate: false`, which it wrote as `options: {}`',
  },
  {
    project: 'postgres-emptied-value-and-policy',
    holds:
      'that index option and a policy with no roles, whose `roles: []` it wrote in the file and left out of the hash',
  },
])('the $project project 8.0.0-rc.25 wrote from a source holding $holds', ({ project }) => {
  const releaseCandidate = join(releaseCandidateDir, project);
  const writtenHash: string = readJson(releaseCandidate, CONTRACT).storage.storageHash;
  const newHash = storageHashOf(releaseCandidate, CONTRACT);

  it('names one contract, by the storage hash 8.0.0-rc.25 wrote, in its snapshot, migration and ref', () => {
    expect(namedStorageHashes(releaseCandidate)).toEqual(everywhere(writtenHash));
  });

  describe('when the script runs first', () => {
    const root = copyDirectory(releaseCandidate);
    const run = runScript(root);

    it('gives the contract, its snapshot, the migration and the ref the hash this release computes from the contract', () => {
      expect({
        status: run.status,
        stderr: run.stderr,
        contract: readJson(root, CONTRACT).storage.storageHash,
        named: namedStorageHashes(root),
      }).toEqual({ status: 0, stderr: '', contract: newHash, named: everywhere(newHash) });
      expect(run.stdout).toContain(
        `Storage hashes (old -> new):\n  ${writtenHash} -> ${newHash}\n`,
      );
    });

    it('changes nothing on a second run', () => {
      expect(runScript(root)).toEqual({ status: 0, stdout: NOTHING_CHANGED, stderr: '' });
    });
  });

  describe.each([
    { snapshot: 'a snapshot of it', keepSnapshot: true },
    { snapshot: 'no snapshot of it', keepSnapshot: false },
  ])(
    'when `prisma contract emit` already wrote the contract with this release, and the project has $snapshot',
    ({ keepSnapshot }) => {
      const emitted = join(fixturesDir, 'emitted-by-this-release', project);
      const emittedHash = storageHashOf(emitted, 'contract.json');
      const root = copyDirectory(releaseCandidate);
      cpSync(join(emitted, 'contract.json'), join(root, CONTRACT));
      cpSync(join(emitted, 'contract.d.ts'), join(root, DTS));
      if (!keepSnapshot) rmSync(join(root, 'migrations/snapshots'), { recursive: true });
      const before = readTree(root);
      const run = runScript(root);
      const listing = `Contracts \`prisma contract emit\` already wrote with this release, left as they are. The contract source holds a value the earlier release left out of \`contract.json\`, so the databases were built without it. Each line gives the emitted storage hash, then the new storage hash of the contract without the value, which every migration, ref and snapshot that named the old hash now names. The upgrade instructions say what to do, under "When the emitted contract gets a different storage hash":\n  ${CONTRACT} (${emittedHash}; without the value, ${newHash})\n`;

      it('keeps the emitted contract, and gives the migration, the ref and any snapshot the hash of the contract 8.0.0-rc.25 wrote', () => {
        expect(emittedHash).not.toBe(newHash);
        const named = namedStorageHashes(root);
        expect({
          status: run.status,
          stderr: run.stderr,
          contract: readTree(root)[CONTRACT] === before[CONTRACT],
          dts: readTree(root)[DTS] === before[DTS],
          named,
        }).toEqual({
          status: 0,
          stderr: '',
          contract: true,
          dts: true,
          named: keepSnapshot ? everywhere(newHash) : { ...everywhere(newHash), ...noSnapshot },
        });
        expect(run.stdout).toContain(`  ${writtenHash} -> ${newHash}\n`);
      });

      it('lists the emitted contract with both hashes', () => {
        expect(run.stdout).toContain(listing);
      });

      it('reports only the profile hashes it replaced in a file', () => {
        const snapshot = readJson(releaseCandidate, CONTRACT);
        const replaced = `${snapshot.profileHash} -> ${computeProfileHash(snapshot)}`;
        expect(profileLines(run.stdout)).toEqual(keepSnapshot ? [replaced] : []);
      });

      it('changes nothing on a second run, and lists the emitted contract again', () => {
        expect(runScript(root)).toEqual({
          status: 0,
          stdout: `${NOTHING_CHANGED}${listing}`,
          stderr: '',
        });
      });
    },
  );
});
