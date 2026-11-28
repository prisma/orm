#!/usr/bin/env node
// Usage: node scripts/public-api/error-codes.mjs
//
// Fails when an error code that appears in the published code of the last release does not appear
// in this build's, unless packages/9-public/removed-error-codes.json records the removal
// (records.mjs). Users match on these codes (ADR 239), so a code that disappears silently breaks
// their handling of it.
//
// Both sides are read the same way: the codes written as string literals in the JavaScript of
// each package's dist folder, the last release's from its tarball on the registry and this build's
// from the package folder. Source is not read, because it also holds factories no published bundle
// keeps. A literal counts wherever it is, so a code that is only compared, not raised, is present.
// The codes of a package that removed-packages.json records as removed need no records of their
// own. The last release is the one api:compat compares against (release.mjs).
//
// Needs `pnpm build` and network access to origin and to the registry.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codesInBuiltText } from '../list-error-codes.mjs';
import { publishedPackageDirs } from './api.mjs';
import { compareCodeUnits } from './api-lines.mjs';
import {
  byLastRelease,
  REMOVED_CODES_FILE,
  REMOVED_PACKAGES_FILE,
  RecordsError,
  readRecords,
  recordLine,
} from './records.mjs';
import {
  fetchReleaseTag,
  fetchReleaseTarball,
  LastReleaseError,
  lastRelease,
  packagesAtTag,
} from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DOWNLOAD_FOLDER = '.api-error-codes';

export function codesInBuild(dir) {
  const codes = new Set();
  const visit = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(path);
      } else if (/\.[cm]?js$/.test(entry.name)) {
        for (const code of codesInBuiltText(readFileSync(path, 'utf8'))) codes.add(code);
      }
    }
  };
  visit(dir);
  return codes;
}

export function compareCodes({ version, baseline, current, records }) {
  const sorted = byLastRelease(records, version, (record) => record.code);
  const problems = [...sorted.problems];
  const covering = new Map();
  for (const record of sorted.current) {
    const problem = current.has(record.code)
      ? 'it still appears in the published code of the build. Remove the record.'
      : !baseline.has(record.code)
        ? `it does not appear in the published code of the last release ${version}, outside packages recorded as removed. Remove the record.`
        : covering.has(record.code)
          ? 'it has more than one record. Keep one.'
          : record.replacedBy !== null && !current.has(record.replacedBy)
            ? `the record says replacedBy ${record.replacedBy}, which does not appear in the published code of the build.`
            : undefined;
    if (problem === undefined) covering.set(record.code, record);
    else problems.push(`${record.code}: ${problem}`);
  }
  const missing = [...baseline.keys()]
    .filter((code) => !current.has(code) && !covering.has(code))
    .sort(compareCodeUnits)
    .map((code) => ({
      code,
      packages: baseline.get(code),
      record: { code, lastRelease: version, replacedBy: null, reason: '…' },
    }));
  return {
    missing,
    recorded: [...covering.values()],
    removable: sorted.removable,
    problems,
  };
}

// Unpacks the package's published tarball into `dir`. False when the registry has no such
// version.
export async function downloadRelease(name, version, dir, { tarball = fetchReleaseTarball } = {}) {
  const bytes = await tarball(name, version);
  if (bytes === undefined) return false;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = `${dir}.tgz`;
  writeFileSync(file, bytes);
  try {
    execFileSync('tar', ['-xzf', file, '-C', dir], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    rmSync(file, { force: true });
  }
  return true;
}

export function reportText({ version, baseline, current, removedPackages, comparison, problems }) {
  const lines = [
    `api:compat:error-codes: ${baseline.size} error codes appear in the published code of the last release ${version}, and ${current.size} in this build's; a code that no longer appears fails unless recorded in ${REMOVED_CODES_FILE}`,
  ];
  for (const name of removedPackages) {
    lines.push(
      `  removed package  ${name}: recorded in ${REMOVED_PACKAGES_FILE}, so its codes are not checked`,
    );
  }
  for (const each of comparison.missing) {
    lines.push(`  no longer appears  ${each.code} (${each.packages.join(', ')})`);
    lines.push(`    to record it: ${recordLine(each.record, 'removedCodes')}`);
  }
  for (const each of comparison.recorded) {
    const replaced = each.replacedBy === null ? '' : `, replaced by ${each.replacedBy}`;
    lines.push(`  recorded removal  ${each.code}: ${each.reason}${replaced}`);
  }
  for (const each of comparison.removable) {
    lines.push(
      `  removable record  ${each.code}: for the last release ${each.lastRelease}, earlier than this one`,
    );
  }
  for (const problem of [...problems, ...comparison.problems]) lines.push(`  problem  ${problem}`);
  return `${lines.join('\n')}\n`;
}

const steps = {
  readRemovedCodes: (root) =>
    readRecords(join(root, REMOVED_CODES_FILE), 'removedCodes', REMOVED_CODES_FILE),
  readRemovedPackages: (root) =>
    readRecords(join(root, REMOVED_PACKAGES_FILE), 'removedPackages', REMOVED_PACKAGES_FILE),
  findRelease: (root) => lastRelease({ root }),
  fetchTag: fetchReleaseTag,
  packagesAt: packagesAtTag,
  download: downloadRelease,
  currentPackages: (root) =>
    publishedPackageDirs(root).packageDirs.map((dir) => ({
      dir,
      name: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
    })),
};

function codesOfBuild(packages, problems) {
  const codes = new Set();
  for (const { name, dir } of packages) {
    const dist = join(dir, 'dist');
    if (!existsSync(dist)) {
      problems.push(`${name}: the package has no dist folder; run pnpm build`);
      continue;
    }
    for (const code of codesInBuild(dist)) codes.add(code);
  }
  return codes;
}

async function codesOfRelease({ names, version, root, download, problems }) {
  const codes = new Map();
  for (const name of names) {
    const dir = join(root, DOWNLOAD_FOLDER, version, name);
    let found;
    try {
      found = await download(name, version, dir);
    } catch (error) {
      if (!(error instanceof LastReleaseError)) throw error;
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    if (!found) {
      problems.push(
        `${name}: the release v${version} has this package, but the registry has no version ${version} of it; if it was published moments ago, the registry may not show it yet`,
      );
      continue;
    }
    const dist = join(dir, 'package', 'dist');
    if (!existsSync(dist)) {
      problems.push(`${name}: the published package has no dist folder`);
      continue;
    }
    for (const code of codesInBuild(dist)) codes.set(code, [...(codes.get(code) ?? []), name]);
  }
  return codes;
}

export async function main({
  root,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  ...replaced
}) {
  const {
    readRemovedCodes,
    readRemovedPackages,
    findRelease,
    fetchTag,
    packagesAt,
    download,
    currentPackages,
  } = { ...steps, ...replaced };
  const fail = (message) => {
    stderr.write(`api:compat:error-codes: ${message}\n`);
    return 1;
  };
  let records;
  let packageRecords;
  let version;
  let released;
  try {
    records = readRemovedCodes(root);
    packageRecords = readRemovedPackages(root);
    const release = await findRelease(root);
    version = release.version;
    fetchTag(release.tag, root);
    released = packagesAt(release.tag, root);
  } catch (error) {
    if (error instanceof RecordsError || error instanceof LastReleaseError) {
      return fail(error.message);
    }
    throw error;
  }

  const problems = [];
  const inBuild = currentPackages(root);
  const current = codesOfBuild(inBuild, problems);
  const recordedRemoved = new Set(
    byLastRelease(packageRecords, version, (record) => record.package).current.map(
      (record) => record.package,
    ),
  );
  const removedPackages = released.filter(
    (name) => recordedRemoved.has(name) && !inBuild.some((each) => each.name === name),
  );
  const baseline = await codesOfRelease({
    names: released.filter((name) => !removedPackages.includes(name)),
    version,
    root,
    download,
    problems,
  });
  if (baseline.size === 0) {
    problems.push(`found no error codes in the published code of the last release ${version}`);
  }
  if (current.size === 0) problems.push("found no error codes in this build's published code");

  const comparison = compareCodes({ version, baseline, current, records });
  const text = reportText({ version, baseline, current, removedPackages, comparison, problems });
  stdout.write(text);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `## Error codes since the last release, ${version}\n\n\`\`\`text\n${text}\`\`\`\n`,
    );
  }
  const fails =
    comparison.missing.length > 0 || comparison.problems.length > 0 || problems.length > 0;
  return fails ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ root: resolve(here, '..', '..') });
}
