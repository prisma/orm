#!/usr/bin/env node
/**
 * Downloads the newest published release of a Prisma 8 database package, without installing it,
 * and extracts the skill's `upgrading/` tree from it. Prints the extracted folder on stdout.
 *
 * Usage: node fetch-upgrade-guides.mjs <package> [--major <n>] [--registry <url>] [--out <dir>]
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const SKILL_NAME = 'prisma-8';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_MAJOR = 8;
const TIMEOUT_MILLIS = 60_000;
const RELEASED_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(ea|preview|rc)\.(\d+))?$/;
const LEVEL_RANK = { ea: 0, preview: 1, rc: 2 };

export class FetchUpgradeGuidesError extends Error {}

function releaseOrder(version) {
  const parts = RELEASED_VERSION.exec(version);
  if (parts === null) return undefined;
  const [, major, minor, patch, level, counter] = parts;
  const rank = level === undefined ? 3 : LEVEL_RANK[level];
  return [Number(major), Number(minor), Number(patch), rank, Number(counter ?? 0)];
}

function compareOrder(a, b) {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * The highest released version in `major`: a GA version or one at a level (`-ea.N`, `-preview.N`,
 * `-rc.N`), whichever dist-tag it was published under. Development builds (`-dev.N`) and any other
 * pre-release are left out.
 */
export function newestRelease(versions, major) {
  let newest;
  let newestOrder;
  for (const version of versions) {
    const order = releaseOrder(version);
    if (order === undefined || order[0] !== major) continue;
    if (newestOrder === undefined || compareOrder(order, newestOrder) > 0) {
      newest = version;
      newestOrder = order;
    }
  }
  return newest;
}

function npmrcRegistry(text, scope) {
  let scoped;
  let plain;
  for (const line of text.split(/\r?\n/)) {
    const setting = /^\s*([^=#;\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (setting === null) continue;
    const [, key, value] = setting;
    if (scope !== undefined && key === `${scope}:registry`) scoped = value;
    if (key === 'registry') plain = value;
  }
  return scoped ?? plain;
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function environmentRegistry(env) {
  const key =
    'npm_config_registry' in env
      ? 'npm_config_registry'
      : Object.keys(env).find((name) => name.toLowerCase() === 'npm_config_registry');
  const value = key === undefined ? undefined : env[key]?.trim();
  return value === '' ? undefined : value;
}

/**
 * The registry the project installs `packageName` from: `--registry`, then `npm_config_registry`,
 * then a `registry` line (scoped first) in the project's `.npmrc` or the user's, then Yarn's
 * `npmRegistryServer`, then the public registry.
 */
export async function configuredRegistry(packageName, projectDir, env) {
  const fromEnv = environmentRegistry(env);
  if (fromEnv !== undefined) return fromEnv;
  const scope = packageName.startsWith('@') ? packageName.split('/')[0] : undefined;
  for (const path of [join(projectDir, '.npmrc'), join(homedir(), '.npmrc')]) {
    const text = await readIfExists(path);
    const registry = text === undefined ? undefined : npmrcRegistry(text, scope);
    if (registry !== undefined) return registry;
  }
  const yarnrc = await readIfExists(join(projectDir, '.yarnrc.yml'));
  const yarnRegistry =
    yarnrc === undefined
      ? undefined
      : /^npmRegistryServer:\s*["']?([^"'\s]+)["']?\s*$/m.exec(yarnrc)?.[1];
  return yarnRegistry ?? DEFAULT_REGISTRY;
}

async function installedMajor(packageName, projectDir) {
  const text = await readIfExists(join(projectDir, 'node_modules', packageName, 'package.json'));
  if (text === undefined) return DEFAULT_MAJOR;
  try {
    const order = releaseOrder(String(JSON.parse(text).version).replace(/-dev\.\d+$/, ''));
    return order === undefined ? DEFAULT_MAJOR : order[0];
  } catch {
    return DEFAULT_MAJOR;
  }
}

function describeFailure(error) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
  const code = cause === undefined ? undefined : Reflect.get(cause, 'code');
  return typeof code === 'string' ? code : (cause ?? error).message;
}

async function download(url, what) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MILLIS),
    });
  } catch (error) {
    throw new FetchUpgradeGuidesError(
      `could not reach ${url} to read ${what}: ${describeFailure(error)}`,
    );
  }
  if (response.status === 404) {
    throw new FetchUpgradeGuidesError(`${what} was not found at ${url}`);
  }
  if (!response.ok) {
    throw new FetchUpgradeGuidesError(
      `${url} answered ${response.status} ${response.statusText} when asked for ${what}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

function checkIntegrity(content, dist, label) {
  const integrity = typeof dist.integrity === 'string' ? dist.integrity : undefined;
  if (integrity !== undefined) {
    const matches = integrity.split(/\s+/).some((entry) => {
      const [algorithm, expected] = entry.split(/-(.*)/s);
      if (!['sha512', 'sha384', 'sha256'].includes(algorithm)) return false;
      return createHash(algorithm).update(content).digest('base64') === expected;
    });
    if (!matches) {
      throw new FetchUpgradeGuidesError(`the tarball of ${label} does not match its integrity`);
    }
    return;
  }
  if (typeof dist.shasum === 'string') {
    if (createHash('sha1').update(content).digest('hex') !== dist.shasum) {
      throw new FetchUpgradeGuidesError(`the tarball of ${label} does not match its shasum`);
    }
  }
}

function text(block, start, length) {
  const field = block.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf-8');
}

function paxPath(content) {
  let offset = 0;
  let path;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number(content.subarray(offset, space).toString('utf-8'));
    if (!Number.isInteger(length) || length <= 0) break;
    const record = content.subarray(space + 1, offset + length - 1).toString('utf-8');
    const equals = record.indexOf('=');
    if (record.slice(0, equals) === 'path') path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

/** Each regular file in a tar archive, with its path. */
export function* tarFiles(archive) {
  let offset = 0;
  let longPath;
  while (offset + 512 <= archive.length) {
    const block = archive.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) return;
    const size = Number.parseInt(text(block, 124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size)) {
      throw new FetchUpgradeGuidesError('the tarball has an entry whose size cannot be read');
    }
    const type = text(block, 156, 1);
    const content = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      longPath = paxPath(content);
      continue;
    }
    if (type === 'L') {
      longPath = text(content, 0, content.length);
      continue;
    }
    if (type === 'g') continue;
    const prefix = text(block, 257, 6) === 'ustar' ? text(block, 345, 155) : '';
    const name = text(block, 0, 100);
    const path = longPath ?? (prefix === '' ? name : `${prefix}/${name}`);
    longPath = undefined;
    if (type === '0' || type === '' || type === '7') yield { path, content };
  }
}

/** Writes the skill's `upgrading/` tree from a package tarball into `destination`. */
export async function extractUpgrading(tarball, destination) {
  const archive = gunzipSync(tarball);
  const inside = `skills/${SKILL_NAME}/upgrading/`;
  const root = resolve(destination);
  let count = 0;
  for (const { path, content } of tarFiles(archive)) {
    const withinPackage = path.replaceAll('\\', '/').split('/').slice(1).join('/');
    if (!withinPackage.startsWith(inside)) continue;
    const relative = withinPackage.slice(inside.length);
    const target = resolve(root, ...relative.split('/'));
    if (
      isAbsolute(relative) ||
      relative.split('/').includes('..') ||
      !target.startsWith(root + sep)
    ) {
      throw new FetchUpgradeGuidesError(`the tarball has an entry outside its folder: ${path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    count++;
  }
  if (count === 0) {
    throw new FetchUpgradeGuidesError(`the tarball has no skills/${SKILL_NAME}/upgrading/ folder`);
  }
}

/**
 * Downloads the newest release of `packageName` in `major` and extracts its upgrade guides. Returns
 * the version and the extracted `upgrading/` folder.
 */
export async function fetchUpgradeGuides({ packageName, major, registry, out }) {
  const base = registry.replace(/\/+$/, '');
  const packument = JSON.parse(
    (await download(`${base}/${packageName.replace('/', '%2f')}`, packageName)).toString('utf-8'),
  );
  const versions = Object.keys(packument.versions ?? {});
  const version = newestRelease(versions, major);
  if (version === undefined) {
    throw new FetchUpgradeGuidesError(
      `${packageName} has no published ${major}.x release at ${base}`,
    );
  }
  const label = `${packageName}@${version}`;
  const dist = packument.versions[version].dist ?? {};
  if (typeof dist.tarball !== 'string') {
    throw new FetchUpgradeGuidesError(`${base} gives no tarball for ${label}`);
  }
  const tarball = await download(dist.tarball, `the tarball of ${label}`);
  checkIntegrity(tarball, dist, label);
  const folder = join(out, `${packageName.replace(/^@/, '').replace('/', '-')}-${version}`);
  await rm(folder, { recursive: true, force: true });
  const upgrading = join(folder, 'upgrading');
  await extractUpgrading(tarball, upgrading);
  return { version, folder: upgrading };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      major: { type: 'string' },
      registry: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (positionals.length !== 1) {
    throw new FetchUpgradeGuidesError(
      'usage: node fetch-upgrade-guides.mjs <package> [--major <n>] [--registry <url>] [--out <dir>]',
    );
  }
  const [packageName] = positionals;
  const projectDir = process.cwd();
  const major =
    values.major === undefined
      ? await installedMajor(packageName, projectDir)
      : Number(values.major);
  if (!Number.isInteger(major) || major < 0) {
    throw new FetchUpgradeGuidesError(`--major ${values.major} is not a major version`);
  }
  const registry =
    values.registry ?? (await configuredRegistry(packageName, projectDir, process.env));
  const out = resolve(
    values.out ?? join(projectDir, 'node_modules', '.cache', 'prisma-upgrade-guides'),
  );
  const { version, folder } = await fetchUpgradeGuides({ packageName, major, registry, out });
  process.stderr.write(`Extracted the upgrade guides of ${packageName}@${version}\n`);
  process.stdout.write(`${folder}\n`);
}

function isEntryPoint() {
  try {
    return realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error) => {
    const message =
      error instanceof FetchUpgradeGuidesError ? error.message : String(error?.stack ?? error);
    process.stderr.write(`fetch-upgrade-guides: ${message}\n`);
    process.exitCode = 1;
  });
}
