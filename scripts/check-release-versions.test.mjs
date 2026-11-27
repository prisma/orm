import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkReleaseVersions,
  versionChanges,
  versionChangesReport,
} from './check-release-versions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', 'wip', `check-release-versions-tests-${process.pid}`);
const git = (...args) =>
  execFileSync('git', args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
const writeManifest = (folder, manifest) => {
  const dir = join(work, 'packages', '9-public', '@prisma', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
};

describe('versionChanges', () => {
  it('lists each package whose planned version is not the committed one', () => {
    deepStrictEqual(
      versionChanges(
        { '@prisma/orm-mysql': '8.1.0-ea.0', '@prisma/orm-postgres': '8.1.0' },
        { '@prisma/orm-mysql': '8.1.0', '@prisma/orm-postgres': '8.1.0' },
      ),
      [{ name: '@prisma/orm-mysql', committed: '8.1.0-ea.0', planned: '8.1.0' }],
    );
  });

  it('is empty when every committed version is the planned one', () => {
    deepStrictEqual(versionChanges({ '@prisma/orm-a': '8.1.0' }, { '@prisma/orm-a': '8.1.0' }), []);
  });
});

describe('versionChangesReport', () => {
  it('names each package with its committed and planned version, and what to do in each case', () => {
    strictEqual(
      versionChangesReport(
        [{ name: '@prisma/orm-mysql', committed: '8.1.0-ea.0', planned: '8.1.0' }],
        '8.1.0',
      ),
      [
        'set-version.ts planned versions other than the committed ones for these packages:',
        '  @prisma/orm-mysql: committed 8.1.0-ea.0, planned 8.1.0',
        'A release publishes only the versions its commit holds.',
        'If this is a release pull request before it merges: run node scripts/set-version.ts 8.1.0 on its branch and commit the result.',
        'If the release pull request has merged: open a pull request that commits the versions node scripts/set-version.ts 8.1.0 writes, merge it, then run the Publish to npm workflow by hand from main with dist-tag=latest.',
        'If this branch is not a release, and this is a dry run to check the release tooling: run the dry run with dist-tag=beta, which skips this check.',
      ].join('\n'),
    );
  });

  it('is undefined when nothing changed', () => {
    strictEqual(versionChangesReport([], '8.1.0'), undefined);
  });
});

describe('checkReleaseVersions', () => {
  before(() => {
    mkdirSync(work, { recursive: true });
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgSign', 'false');
    writeManifest('orm-postgres', { name: '@prisma/orm-postgres', version: '8.1.0' });
    writeManifest('orm-mysql', { name: '@prisma/orm-mysql', version: '8.1.0-ea.0' });
    writeManifest('orm-internal', {
      name: '@prisma/orm-internal',
      version: '8.1.0',
      private: true,
    });
    git('add', '.');
    git('commit', '--quiet', '-m', 'release');
  });
  after(() => rmSync(work, { recursive: true, force: true }));

  it('passes when the working tree holds the committed versions', () => {
    strictEqual(checkReleaseVersions(work, '8.1.0'), undefined);
  });

  it('reports a published package whose version on disk is not the one committed at HEAD', () => {
    writeManifest('orm-mysql', { name: '@prisma/orm-mysql', version: '8.1.0' });
    writeManifest('orm-internal', {
      name: '@prisma/orm-internal',
      version: '9.0.0',
      private: true,
    });
    const report = checkReleaseVersions(work, '8.1.0');
    match(report, /\n {2}@prisma\/orm-mysql: committed 8\.1\.0-ea\.0, planned 8\.1\.0\n/);
    strictEqual(report.includes('orm-postgres'), false);
    strictEqual(report.includes('orm-internal'), false);
  });
});
