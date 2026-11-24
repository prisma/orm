#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { packageLevels } from '../packages/0-shared/publish-surface/src/levels.ts';
import { isNumberedOnItsOwn } from '../packages/0-shared/publish-surface/src/release-plan.ts';

const PUBLISHED_DIR = 'packages/9-public/@prisma';

/** The opening of the level sentence a published package's README carries for its declared level. */
function levelSentence(level) {
  if (isNumberedOnItsOwn(level)) {
    return `**From \`8.0.0\` this package has its own version number, starting at \`${level.firstVersion}\`.**`;
  }
  const words = {
    ga: 'is Generally Available',
    rc: 'is a Release Candidate',
    preview: 'is in Preview',
    ea: 'is Early Access',
  };
  return `**From \`8.0.0\` this package ${words[level]}.**`;
}

/** Every published package whose README does not state the level `levels.ts` declares for it. */
function levelSentenceErrors() {
  if (!existsSync(PUBLISHED_DIR)) return [];
  const found = [];
  for (const dir of readdirSync(PUBLISHED_DIR)) {
    const manifestPath = join(PUBLISHED_DIR, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const level = packageLevels.get(manifest.name);
    if (manifest.private === true || level === undefined) continue;
    const readmePath = join(PUBLISHED_DIR, dir, 'README.md');
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
    const expected = levelSentence(level);
    if (!readme.includes(expected)) {
      found.push(
        `${readmePath}: does not state the level levels.ts declares; expected "${expected}"`,
      );
    }
  }
  return found;
}

/** Returns package directories that contain a source directory. */
function listSrcParents() {
  let out;
  try {
    out = execFileSync('find', ['packages', '-type', 'd', '-name', 'src'], { encoding: 'utf8' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to list package source directories: ${message}\n`);
    process.exit(1);
  }
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((p) => p.replace(/\/src$/, ''))
    .filter((p) => !/coverage|\.turbo|node_modules/.test(p));
}

const dirs = listSrcParents();
const errors = [];
const warnings = [];

for (const dir of dirs) {
  const readme = `${dir}/README.md`;
  if (!existsSync(readme)) {
    errors.push(`${dir}: missing README.md`);
    continue;
  }
  const txt = readFileSync(readme, 'utf8');
  if (!/^#\s+/m.test(txt)) warnings.push(`${dir}: README missing top-level title`);
  if (!/^##\s+Responsibilities/m.test(txt))
    warnings.push(`${dir}: README missing 'Responsibilities' section`);
}

errors.push(...levelSentenceErrors());

if (errors.length) {
  console.error(`README validation failed:\n${errors.map((e) => ` - ${e}`).join('\n')}`);
  if (warnings.length)
    console.warn(`README warnings:\n${warnings.map((w) => ` - ${w}`).join('\n')}`);
  process.exit(1);
} else if (warnings.length) {
  console.warn(`README warnings:\n${warnings.map((w) => ` - ${w}`).join('\n')}`);
  console.log('Package README presence validated.');
  process.exit(0);
} else {
  console.log('All package READMEs passed validation.');
}
