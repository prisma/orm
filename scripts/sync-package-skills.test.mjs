import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { SKILL_ANCHOR_PACKAGES, SKILL_NAMES, syncPackageSkills } from './sync-package-skills.ts';

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repoRoot, 'scripts', 'sync-package-skills.ts');

const PACKAGE_NAME = '@prisma/orm-postgres';
const packageDir = join(repoRoot, SKILL_ANCHOR_PACKAGES.get(PACKAGE_NAME));
const skillsDir = join(packageDir, 'skills');

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .sort();
}

function assertSyncedTreeMatchesSource() {
  for (const skillName of SKILL_NAMES) {
    const sourceDir = join(repoRoot, 'skills', skillName);
    const destDir = join(skillsDir, skillName);
    assert.deepEqual(filesUnder(destDir), filesUnder(sourceDir), `${skillName} file list differs`);
    for (const file of filesUnder(sourceDir)) {
      if (file === 'SKILL.md') continue;
      assert.equal(
        readFileSync(join(destDir, file), 'utf-8'),
        readFileSync(join(sourceDir, file), 'utf-8'),
        `${skillName}/${file} differs from source`,
      );
    }
  }
}

function assertNoWorkdirLeftovers() {
  const leftovers = readdirSync(packageDir).filter(
    (entry) => entry.startsWith('skills.staging-') || entry.startsWith('skills.trash-'),
  );
  assert.deepEqual(leftovers, [], 'staging/trash directories left behind');
}

test('concurrent syncs of one package all succeed and leave an intact tree', async () => {
  const rounds = 4;
  for (let round = 0; round < rounds; round += 1) {
    await Promise.all(
      Array.from({ length: 3 }, () => execFileAsync('node', [scriptPath, PACKAGE_NAME])),
    );
  }
  assertNoWorkdirLeftovers();
  assertSyncedTreeMatchesSource();
});

test('concurrent in-process syncs of one package all succeed', async () => {
  // Start cold so every call takes the swap path rather than the no-op path.
  await rm(skillsDir, { recursive: true, force: true });
  await Promise.all(Array.from({ length: 4 }, () => syncPackageSkills(PACKAGE_NAME)));
  assertNoWorkdirLeftovers();
  assertSyncedTreeMatchesSource();
});

test('a re-sync with unchanged content leaves the directory untouched', async () => {
  await syncPackageSkills(PACKAGE_NAME);
  const before = await stat(skillsDir);
  await syncPackageSkills(PACKAGE_NAME);
  const after = await stat(skillsDir);
  assert.equal(after.ino, before.ino, 'no-op sync must not replace the skills directory');
  assertNoWorkdirLeftovers();
});

test('a reader never observes an absent file while warm syncs run', async () => {
  await syncPackageSkills(PACKAGE_NAME);
  const files = (await readdir(skillsDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(skillsDir, join(entry.parentPath, entry.name)));
  assert.ok(files.length > 0, 'expected a populated skills tree');

  let stopped = false;
  const reader = (async () => {
    while (!stopped) {
      // A pack's tar phase walks paths exactly like this; every read must
      // succeed while warm re-syncs run concurrently.
      await Promise.all(files.map((file) => readFile(join(skillsDir, file))));
    }
  })();

  try {
    for (let i = 0; i < 5; i += 1) {
      await execFileAsync('node', [scriptPath, PACKAGE_NAME]);
    }
  } finally {
    stopped = true;
  }
  await reader;
  assertNoWorkdirLeftovers();
});
