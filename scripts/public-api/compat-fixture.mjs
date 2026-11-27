// Runs checkPackage on the fixture packages under fixtures/compat, laid out as api-compat.mjs lays
// out the real install. For the tests only.

import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPackage } from './compat.mjs';
import { makeTwin, stampVersion } from './compat-install.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const fixtures = join(here, 'fixtures', 'compat');

// Inside the repository, so that the declarations resolve @types/node through its node_modules.
export function workFolder(name) {
  const work = join(here, '..', '..', 'wip', `${name}-${process.pid}`);
  after(() => rmSync(work, { recursive: true, force: true }));
  return work;
}

export function fixtureCheck(work) {
  return (
    current,
    {
      release = 'release',
      records = [],
      version = '1.0.0',
      stamp = true,
      dependencies = [],
      installed = [],
      own = [],
      mustFail,
      budgetMs,
    } = {},
  ) => {
    const workDir = join(work, `${current}-${Math.random().toString(36).slice(2)}`);
    const modules = join(workDir, 'node_modules');
    const releaseDir = join(modules, 'release-fixture');
    const currentDir = join(modules, 'current-fixture');
    mkdirSync(modules, { recursive: true });
    cpSync(join(fixtures, release), releaseDir, { recursive: true });
    if (stamp) stampVersion(releaseDir);
    cpSync(join(fixtures, current), currentDir, { recursive: true });
    for (const dependency of dependencies) {
      cpSync(join(fixtures, dependency.folder), join(modules, dependency.name), {
        recursive: true,
      });
    }
    const ownNames = ['fixture-compat', ...own];
    for (const { side, folder, name } of installed) {
      const dir = side === 'release' ? releaseDir : currentDir;
      cpSync(join(fixtures, folder), join(dir, 'node_modules', name), { recursive: true });
      if (side === 'release' && own.includes(name)) {
        stampVersion(join(dir, 'node_modules', name));
      }
    }
    const twin = makeTwin({
      releaseDir,
      twinRoot: join(modules, '.twins'),
      ownNames: new Set(ownNames),
    });
    symlinkSync(twin, join(modules, 'twin-fixture'));
    return checkPackage({
      name: 'fixture-compat',
      releaseDir,
      currentDir,
      releaseSpecifier: 'release-fixture',
      currentSpecifier: 'current-fixture',
      twinSpecifier: 'twin-fixture',
      testFile: join(workDir, 'tests', 'fixture.ts'),
      records,
      version,
      ownNames,
      mustFail,
      budgetMs,
    });
  };
}

export const brokenExports = (result) =>
  result.breaks.map(({ path, name, test, failsRun }) => ({ path, name, test, failsRun }));

export const names = (list) => list.map(({ path, name, test }) => `${path} ${name} ${test}`);
