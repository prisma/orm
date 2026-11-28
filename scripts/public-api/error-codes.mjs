#!/usr/bin/env node
// Usage: node scripts/public-api/error-codes.mjs
//
// Fails when an error code the last release could raise is no longer raised by this build, unless
// packages/9-public/removed-error-codes.json records the removal (records.mjs). Users match on
// these codes (ADR 239), so a code that disappears silently breaks their handling of it.
//
// Both sides are read the same way: the codes written as string literals in the published
// JavaScript of each package, the last release's from its tarballs on the registry and this
// build's from each package's dist folder. Source is not read, because it also holds factories no
// published bundle keeps. The last release is the one api:compat compares against (release.mjs).
//
// Needs `pnpm build` and network access to origin and to the registry.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  RecordsError,
  readRecords,
  recordLine,
} from './records.mjs';
import {
  fetchPackument,
  fetchReleaseTag,
  LastReleaseError,
  lastRelease,
  packagesAtTag,
} from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DOWNLOAD_FOLDER = '.api-error-codes';
const REGISTRY_TARBALLS = 'https://registry.npmjs.org/';
const DOWNLOAD_ATTEMPTS = 3;

export class DownloadError extends Error {}

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
      ? 'the build still raises it. Remove the record.'
      : !baseline.has(record.code)
        ? `the last release ${version} does not raise it. Remove the record.`
        : covering.has(record.code)
          ? 'it has more than one record. Keep one.'
          : record.replacedBy !== null && !current.has(record.replacedBy)
            ? `the record says replacedBy ${record.replacedBy}, which the build does not raise.`
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

async function fetchTarball(url, fetchImpl) {
  let failure;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      failure = error.message;
      continue;
    }
    if (!response.ok) throw new DownloadError(`${url}: the registry answered ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new DownloadError(`${url}: no answer after ${DOWNLOAD_ATTEMPTS} attempts: ${failure}`);
}

// Unpacks the package's published tarball into `dir`, after checking it against the integrity the
// registry lists. False when the registry has no such version.
export async function downloadRelease(
  name,
  version,
  dir,
  { packument = fetchPackument, fetchImpl = fetch } = {},
) {
  const dist = (await packument(name))?.versions?.[version]?.dist;
  if (dist === undefined) return false;
  if (!String(dist.tarball).startsWith(REGISTRY_TARBALLS)) {
    throw new DownloadError(
      `${name}@${version}: the tarball ${dist.tarball} is not on the registry`,
    );
  }
  const bytes = await fetchTarball(dist.tarball, fetchImpl);
  const separator = String(dist.integrity).indexOf('-');
  const algorithm = dist.integrity.slice(0, separator);
  if (
    createHash(algorithm).update(bytes).digest('base64') !== dist.integrity.slice(separator + 1)
  ) {
    throw new DownloadError(`${name}@${version}: the tarball does not match its integrity`);
  }
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

export function reportText({ version, baseline, current, comparison, problems }) {
  const lines = [
    `api:compat:error-codes: last release ${version} raises ${baseline.size} codes; this build raises ${current.size}; a code no longer raised fails unless recorded in ${REMOVED_CODES_FILE}`,
  ];
  for (const each of comparison.missing) {
    lines.push(`  no longer raised  ${each.code} (${each.packages.join(', ')})`);
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

export async function main({
  root,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  ...replaced
}) {
  const { readRemovedCodes, findRelease, fetchTag, packagesAt, download, currentPackages } = {
    ...steps,
    ...replaced,
  };
  const fail = (message) => {
    stderr.write(`api:compat:error-codes: ${message}\n`);
    return 1;
  };
  let records;
  let version;
  let released;
  try {
    records = readRemovedCodes(root);
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
  const baseline = new Map();
  const downloads = join(root, DOWNLOAD_FOLDER, version);
  for (const name of released) {
    const dir = join(downloads, name);
    let found;
    try {
      found = await download(name, version, dir);
    } catch (error) {
      if (!(error instanceof DownloadError || error instanceof LastReleaseError)) throw error;
      problems.push(`${name}: ${error.message}`);
      continue;
    }
    if (!found) {
      problems.push(
        `${name}: the release v${version} has this package, but the registry has no version ${version} of it; if it was published moments ago, the registry may not show it yet`,
      );
      continue;
    }
    for (const code of codesInBuild(dir)) baseline.set(code, [...(baseline.get(code) ?? []), name]);
  }

  const current = new Set();
  for (const { name, dir } of currentPackages(root)) {
    const dist = join(dir, 'dist');
    if (!existsSync(dist)) {
      problems.push(`${name}: the package has no dist folder; run pnpm build`);
      continue;
    }
    for (const code of codesInBuild(dist)) current.add(code);
  }
  if (baseline.size === 0) problems.push(`found no error codes in the last release ${version}`);
  if (current.size === 0) problems.push('found no error codes in this build');

  const comparison = compareCodes({ version, baseline, current, records });
  const text = reportText({ version, baseline, current, comparison, problems });
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
