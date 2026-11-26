#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { packageKinds, packageNumbering } from '../packages/0-shared/publish-surface/src/levels.ts';
import { hasOwnVersion } from '../packages/0-shared/publish-surface/src/release-plan.ts';
import { publicShells } from '../packages/0-shared/publish-surface/src/shells.ts';

const PUBLISHED_DIR = 'packages/9-public/@prisma';

/** The sentence a published package's README opens its level note with, for its declared level. */
function levelSentence(level) {
  if (hasOwnVersion(level)) return '**Maturity level: none; this package has its own version.**';
  const words = {
    ga: 'Generally Available',
    rc: 'Release Candidate',
    preview: 'Preview',
    ea: 'Early Access',
  };
  return `**Maturity level: ${words[level]}.**`;
}

/** Every published package whose README does not state the level `levels.ts` declares for it. */
function levelSentenceErrors() {
  if (!existsSync(PUBLISHED_DIR)) return [];
  const found = [];
  for (const dir of readdirSync(PUBLISHED_DIR)) {
    const manifestPath = join(PUBLISHED_DIR, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const level = packageNumbering.get(manifest.name);
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

const kinds = packageKinds(publicShells);
const SPEC = /"?(@prisma\/orm-[a-z0-9-]+)@([~^])([^"\s]+)"?/g;

/**
 * The problems with one shell block's `pnpm add` commands: each package of ours written with
 * `-<level>.0` exactly when it is below GA, and a caret only beside a GA database package. The
 * database package is the facade the command adds, or the one a preceding `# beside <name>` names.
 */
function installCommandErrors(block) {
  const found = [];
  let beside;
  for (const line of block.split('\n')) {
    const comment = /^#\s*beside\s+(@prisma\/orm-[a-z0-9-]+)/.exec(line.trim());
    if (comment) beside = comment[1];
    if (!/^pnpm add\b/.test(line.trim())) continue;
    const specs = [...line.matchAll(SPEC)].map(([, name, operator, version]) => ({
      name,
      operator,
      version,
    }));
    const facade = specs.find(({ name }) => kinds[name] === 'facade')?.name ?? beside;
    const facadeLevel = facade === undefined ? undefined : packageNumbering.get(facade);
    for (const { name, operator, version } of specs) {
      const level = packageNumbering.get(name);
      if (level === undefined || hasOwnVersion(level)) continue;
      const suffix = /-(ea|preview|rc)\.0$/.exec(version)?.[1];
      if (level === 'ga' ? version.includes('-') : suffix !== level) {
        found.push(
          `${name}@${operator}${version} does not match its level, ${level}: ${level === 'ga' ? 'a GA package has no suffix' : `write -${level}.0`}`,
        );
      }
      if (facadeLevel === undefined || hasOwnVersion(facadeLevel)) continue;
      const expected = facadeLevel === 'ga' && level === 'ga' ? '^' : '~';
      if (operator !== expected) {
        found.push(
          `${name}@${operator}${version} beside ${facade} (${facadeLevel}) takes ${expected === '^' ? 'a caret' : 'a tilde'}`,
        );
      }
    }
  }
  return found;
}

/** Every published package whose README's install commands do not follow the levels. */
function installCommandReadmeErrors() {
  if (!existsSync(PUBLISHED_DIR)) return [];
  const found = [];
  for (const dir of readdirSync(PUBLISHED_DIR)) {
    const readmePath = join(PUBLISHED_DIR, dir, 'README.md');
    if (!existsSync(readmePath)) continue;
    const readme = readFileSync(readmePath, 'utf8');
    for (const [, block] of readme.matchAll(/^```(?:sh|bash|shell)\n([\s\S]*?)^```/gm)) {
      for (const problem of installCommandErrors(block)) found.push(`${readmePath}: ${problem}`);
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

errors.push(...levelSentenceErrors(), ...installCommandReadmeErrors());

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
