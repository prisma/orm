#!/usr/bin/env node
// Usage: node scripts/check-release-versions.mjs <version>, after `set-version.ts <version>`.
//
// Fails when set-version.ts gave a published package another version than the one committed at
// HEAD. The API compatibility job reads each package's version at a release from its package.json
// at the release's tag, so a release must publish exactly the versions it commits. Only `version`
// is compared: set-version.ts also rewrites `workspace:` dependency specifiers.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLISHED = 'packages/9-public/@prisma';

export function versionChanges(committed, planned) {
  return Object.keys(committed)
    .sort()
    .filter((name) => committed[name] !== planned[name])
    .map((name) => ({ name, committed: committed[name], planned: planned[name] }));
}

export function versionChangesReport(changes, version) {
  if (changes.length === 0) return undefined;
  return [
    'set-version.ts planned versions other than the committed ones for these packages:',
    ...changes.map(
      ({ name, committed, planned }) => `  ${name}: committed ${committed}, planned ${planned}`,
    ),
    `The release pull request must commit the versions set-version.ts writes: run node scripts/set-version.ts ${version} on its branch and commit the result.`,
  ].join('\n');
}

function main(root, version) {
  const files = execFileSync('git', ['ls-files', '--', `${PUBLISHED}/*/package.json`], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /^packages\/9-public\/@prisma\/[^/]+\/package\.json$/.test(file));
  const committed = {};
  const planned = {};
  for (const file of files) {
    const atHead = JSON.parse(
      execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' }),
    );
    if (atHead.private === true) continue;
    committed[atHead.name] = atHead.version;
    planned[atHead.name] = JSON.parse(readFileSync(join(root, file), 'utf8')).version;
  }
  const report = versionChangesReport(versionChanges(committed, planned), version);
  if (report === undefined) return 0;
  console.error(report);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/check-release-versions.mjs <version>');
    process.exitCode = 1;
  } else {
    process.exitCode = main(join(fileURLToPath(new URL('.', import.meta.url)), '..'), version);
  }
}
