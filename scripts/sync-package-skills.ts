#!/usr/bin/env node

/**
 * Copies the user-facing `skills/prisma-orm-*` trees into the packages that
 * ship them, stamping each copy with the package it now belongs to.
 *
 * Usage: node scripts/sync-package-skills.ts [<package-name>...]
 *
 * Run from each shipping package's `prepack`, so the tarball always carries
 * the skill trees that match the code beside it. The copies are build
 * output: they are gitignored, and `files` carries them into the tarball.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stampSkillMetadata } from './set-version-utils.ts';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The packages the skill ships in: the three targets an application depends
 * on directly. Shipping from the direct dependencies is what lets a consumer's
 * `prisma skills sync` resolve the skill by package name instead of searching
 * `node_modules` for skill files.
 */
export const SKILL_ANCHOR_PACKAGES: ReadonlyMap<string, string> = new Map([
  ['@prisma/orm-postgres', 'packages/9-public/@prisma/orm-postgres'],
  ['@prisma/orm-sqlite', 'packages/9-public/@prisma/orm-sqlite'],
  ['@prisma/orm-mongo', 'packages/9-public/@prisma/orm-mongo'],
]);

export const SKILL_NAMES = ['prisma-orm-core-concepts', 'prisma-orm-migrations'] as const;

/** Every file under `dir` as sorted relative paths, or null when `dir` is absent. */
async function listFiles(dir: string): Promise<readonly string[] | null> {
  try {
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .sort();
  } catch {
    return null;
  }
}

/** Whether `actualDir` already holds exactly the tree `expectedDir` holds. */
async function treesMatch(expectedDir: string, actualDir: string): Promise<boolean> {
  const [expected, actual] = await Promise.all([listFiles(expectedDir), listFiles(actualDir)]);
  if (expected === null || actual === null) return false;
  if (expected.length !== actual.length) return false;
  if (expected.some((file, index) => file !== actual[index])) return false;
  for (const file of expected) {
    const [expectedContent, actualContent] = await Promise.all([
      fs.readFile(path.join(expectedDir, file)),
      fs.readFile(path.join(actualDir, file)).catch(() => null),
    ]);
    if (actualContent === null || !expectedContent.equals(actualContent)) return false;
  }
  return true;
}

/**
 * Concurrent in-process calls must not share work directories either, so the
 * pid is paired with a per-invocation counter.
 */
let invocation = 0;

export async function syncPackageSkills(packageName: string): Promise<readonly string[]> {
  invocation += 1;
  const workId = `${process.pid}-${invocation}`;
  const packageDir = SKILL_ANCHOR_PACKAGES.get(packageName);
  if (packageDir === undefined) {
    const shipping = [...SKILL_ANCHOR_PACKAGES.keys()].join(', ');
    throw new Error(`${packageName} does not ship the Prisma skills; expected ${shipping}`);
  }

  // Concurrent packs of the same package (tarball tests run in parallel and
  // each pack re-runs this prepack) must never observe a half-copied tree, so
  // the copies are staged in a temporary sibling and swapped in with renames.
  const skillsDir = path.join(rootDir, packageDir, 'skills');
  const stagingDir = `${skillsDir}.staging-${workId}`;
  const results = SKILL_NAMES.map((skillName) => path.join(skillsDir, skillName));
  await fs.rm(stagingDir, { recursive: true, force: true });
  for (const skillName of SKILL_NAMES) {
    const source = path.join(rootDir, 'skills', skillName);
    const staged = path.join(stagingDir, skillName);
    await fs.cp(source, staged, { recursive: true });

    // The source tree names one canonical package; each copy names its own,
    // so a consumer reading the copy sees the package it resolved it from.
    const skillMd = path.join(staged, 'SKILL.md');
    await fs.writeFile(
      skillMd,
      stampSkillMetadata(await fs.readFile(skillMd, 'utf-8'), 'library', packageName),
    );
  }

  // A concurrent pack's tar phase may be reading `skills/` right now, after
  // its own prepack returned. When the staged tree is already what is on
  // disk — every pack after the first — leave the directory untouched so that
  // reader can never observe an absent or partial tree.
  if (await treesMatch(stagingDir, skillsDir)) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    return results;
  }

  // The swap itself can collide with a concurrent prepack landing its own
  // rename first. Every copy carries identical content, so retrying the whole
  // swap converges instead of failing the pack. Retiring the old tree via
  // rename (not a progressive recursive delete) keeps the path's absence down
  // to the instant between the two renames.
  const trashDir = `${skillsDir}.trash-${workId}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rm(trashDir, { recursive: true, force: true });
      await fs.rename(skillsDir, trashDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await fs.rename(stagingDir, skillsDir);
      break;
    } catch (error) {
      if (attempt >= 5) {
        await fs.rm(stagingDir, { recursive: true, force: true });
        await fs.rm(trashDir, { recursive: true, force: true });
        throw error;
      }
    }
  }
  await fs.rm(trashDir, { recursive: true, force: true });

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const requested = process.argv.slice(2);
  const targets = requested.length > 0 ? requested : [...SKILL_ANCHOR_PACKAGES.keys()];
  for (const packageName of targets) {
    for (const destination of await syncPackageSkills(packageName)) {
      console.log(`Copied ${path.relative(rootDir, destination)}`);
    }
  }
}
