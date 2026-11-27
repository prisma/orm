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
    'A release publishes only the versions its commit holds.',
    `If this is a release pull request before it merges: run node scripts/set-version.ts ${version} on its branch and commit the result.`,
    `If the release pull request has merged: open a pull request that commits the versions node scripts/set-version.ts ${version} writes, merge it, then run the Publish to npm workflow by hand from main with dist-tag=latest and dry-run=false.`,
    'If this branch is not a release, and this is a dry run to check the release tooling: run the dry run with dist-tag=beta, which skips this check.',
  ].join('\n');
}

export function checkReleaseVersions(root, version) {
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
  return versionChangesReport(versionChanges(committed, planned), version);
}

function main(root, version) {
  const report = checkReleaseVersions(root, version);
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
