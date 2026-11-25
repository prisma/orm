import { deepStrictEqual } from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aliasOf, thirdPartyVersions } from './compat-install.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '..', 'wip', `api-compat-install-tests-${process.pid}`);
after(() => rmSync(work, { recursive: true, force: true }));

function writePackage(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

describe('thirdPartyVersions', () => {
  it('pins each third-party dependency, direct or not, to its installed version, under its parent when it is installed twice', () => {
    const a = join(work, 'orm-a');
    const b = join(work, 'orm-b');
    writePackage(a, {
      name: '@prisma/orm-a',
      dependencies: { '@prisma/orm-b': 'workspace:*', x: '^1' },
      peerDependencies: { 'missing-peer': '^1' },
    });
    writePackage(join(a, 'node_modules', 'x'), {
      name: 'x',
      version: '1.0.0',
      dependencies: { y: '^2' },
    });
    writePackage(join(a, 'node_modules', 'y'), { name: 'y', version: '2.0.0' });
    writePackage(b, { name: '@prisma/orm-b', dependencies: { y: '^3' } });
    writePackage(join(b, 'node_modules', 'y'), { name: 'y', version: '3.0.0' });
    mkdirSync(join(a, 'node_modules', '@prisma'), { recursive: true });
    symlinkSync(b, join(a, 'node_modules', '@prisma', 'orm-b'));

    deepStrictEqual(thirdPartyVersions([a], new Set(['@prisma/orm-a', '@prisma/orm-b'])), {
      versions: { '@prisma/orm-b>y': '3.0.0', x: '1.0.0', 'x>y': '2.0.0' },
      conflicts: {},
    });
  });

  it('pins under the parent and its version when the parent is installed twice as well', () => {
    const own = join(work, 'orm-c');
    writePackage(own, { name: '@prisma/orm-c', dependencies: { p: '^1', q: '^1' } });
    writePackage(join(own, 'node_modules', 'p'), {
      name: 'p',
      version: '1.0.0',
      dependencies: { z: '^1' },
    });
    writePackage(join(own, 'node_modules', 'p', 'node_modules', 'z'), {
      name: 'z',
      version: '1.0.0',
    });
    writePackage(join(own, 'node_modules', 'q'), {
      name: 'q',
      version: '1.0.0',
      dependencies: { p: '^2' },
    });
    writePackage(join(own, 'node_modules', 'q', 'node_modules', 'p'), {
      name: 'p',
      version: '2.0.0',
      dependencies: { z: '^2' },
    });
    writePackage(join(own, 'node_modules', 'q', 'node_modules', 'p', 'node_modules', 'z'), {
      name: 'z',
      version: '2.0.0',
    });

    deepStrictEqual(thirdPartyVersions([own], new Set(['@prisma/orm-c'])).versions, {
      '@prisma/orm-c>p': '1.0.0',
      'p@1.0.0>z': '1.0.0',
      'p@2.0.0>z': '2.0.0',
      q: '1.0.0',
      'q>p': '2.0.0',
    });
  });
});

describe('aliasOf', () => {
  it('names the installed copy of each side', () => {
    deepStrictEqual(
      [aliasOf('release', '@prisma/orm-postgres'), aliasOf('current', '@prisma/orm-postgres')],
      ['release-orm-postgres', 'current-orm-postgres'],
    );
  });
});
