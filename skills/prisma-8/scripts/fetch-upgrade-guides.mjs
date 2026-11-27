#!/usr/bin/env node
/**
 * Downloads the newest published release of a Prisma 8 database package, without installing it,
 * and extracts its copy of this skill. Prints the extracted `prisma-8` folder on stdout.
 *
 * Usage: node fetch-upgrade-guides.mjs <package> [--major <n>] [--registry <url>] [--out <dir>]
 */

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const SKILL_NAME = 'prisma-8';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_FOLDER = '.prisma-upgrade-guides';
const TIMEOUT_MILLIS = 60_000;
const PACKAGE_MANAGER = ['n', 'pm'].join('');
const USAGE =
  'usage: node fetch-upgrade-guides.mjs <package> [--major <n>] [--registry <url>] [--out <dir>]';
const RELEASED_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(ea|preview|rc)\.(\d+))?$/;
const LEVEL_RANK = { ea: 0, preview: 1, rc: 2 };
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_SOCKET_TIMEOUT',
]);

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
 * The released versions, newest first, optionally of one major: GA versions and versions at a
 * level (`-ea.N`, `-preview.N`, `-rc.N`). Development builds and other pre-releases are left out.
 */
export function releaseCandidates(versions, major) {
  return versions
    .map((version) => ({ version, order: releaseOrder(version) }))
    .filter(({ order }) => order !== undefined && (major === undefined || order[0] === major))
    .sort((a, b) => compareOrder(b.order, a.order))
    .map(({ version }) => version);
}

/** The first candidate that is not deprecated, or the first candidate when all are. */
export async function chooseRelease(candidates, isDeprecated) {
  for (const version of candidates) {
    if (!(await isDeprecated(version))) return { version, deprecated: false };
  }
  return candidates.length === 0 ? undefined : { version: candidates[0], deprecated: true };
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function lookUp(env, name) {
  if (name in env) return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function settingValue(raw, env) {
  const trimmed = raw.trim();
  const unquoted = /^(["'])(.*)\1$/.exec(trimmed)?.[2] ?? trimmed;
  return unquoted.replace(/\$\{([^}?]+)(\?)?\}/g, (_, name, optional) => {
    const value = env[name];
    if (value !== undefined) return value;
    if (optional === '?') return '';
    throw new FetchUpgradeGuidesError(`a registry setting uses \${${name}}, which is not set`);
  });
}

function npmrcSettings(text) {
  const settings = new Map();
  for (const line of text.split(/\r?\n/)) {
    const setting = /^\s*([^=#;\s][^=]*?)\s*=(.*)$/.exec(line);
    if (setting !== null) settings.set(setting[1], setting[2]);
  }
  return settings;
}

function yarnSettings(text, scope) {
  let plain;
  let scoped;
  let inScopes = false;
  let currentScope;
  for (const line of text.split(/\r?\n/)) {
    const entry = /^(\s*)["']?([^"':#]+)["']?\s*:\s*(.*?)\s*$/.exec(line);
    if (entry === null) continue;
    const [, indent, key, value] = entry;
    if (indent.length === 0) {
      inScopes = key === 'npmScopes';
      currentScope = undefined;
      if (key === 'npmRegistryServer') plain = value;
    } else if (inScopes && value === '') {
      currentScope = key.replace(/^@/, '');
    } else if (inScopes && key === 'npmRegistryServer' && `@${currentScope}` === scope) {
      scoped = value;
    }
  }
  return { plain, scoped };
}

/**
 * The registry the built-in download reads `packageName` from. In a Yarn project, `.yarnrc.yml`
 * and `YARN_NPM_REGISTRY_SERVER`; otherwise a scoped `registry` setting from the environment, the
 * project's `.npmrc` or the user's, then a plain one in the same order; then the public registry.
 */
export async function configuredRegistry({ packageName, projectDir, homeDir, env }) {
  const scope = packageName.startsWith('@') ? packageName.split('/')[0] : undefined;
  const yarnrc = await readIfExists(join(projectDir, '.yarnrc.yml'));
  if (yarnrc !== undefined) {
    const yarn = yarnSettings(yarnrc, scope);
    const value = yarn.scoped ?? lookUp(env, 'YARN_NPM_REGISTRY_SERVER') ?? yarn.plain;
    if (value !== undefined && value.trim() !== '') return settingValue(value, env);
  }
  const environment = new Map();
  for (const key of ['registry', `${scope}:registry`]) {
    const value = lookUp(env, `npm_config_${key}`);
    if (value !== undefined && value.trim() !== '') environment.set(key, value);
  }
  const sources = [environment];
  for (const path of [join(projectDir, '.npmrc'), join(homeDir, '.npmrc')]) {
    const text = await readIfExists(path);
    if (text !== undefined) sources.push(npmrcSettings(text));
  }
  const keys = scope === undefined ? ['registry'] : [`${scope}:registry`, 'registry'];
  for (const key of keys) {
    for (const source of sources) {
      const value = source.get(key);
      if (value !== undefined) return settingValue(value, env);
    }
  }
  return DEFAULT_REGISTRY;
}

/** Checks `content` against the registry's `integrity` or, failing a known algorithm, `shasum`. */
export function checkIntegrity(content, dist, label) {
  const entries = typeof dist.integrity === 'string' ? dist.integrity.trim().split(/\s+/) : [];
  const known = entries
    .map((entry) => /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(entry))
    .filter((parts) => parts !== null);
  if (known.length > 0) {
    const matches = known.some(
      ([, algorithm, expected]) =>
        createHash(algorithm).update(content).digest('base64') === expected,
    );
    if (!matches) {
      throw new FetchUpgradeGuidesError(`the tarball of ${label} does not match its integrity`);
    }
    return;
  }
  if (typeof dist.shasum === 'string') {
    if (createHash('sha1').update(content).digest('hex') !== dist.shasum) {
      throw new FetchUpgradeGuidesError(`the tarball of ${label} does not match its shasum`);
    }
    return;
  }
  throw new FetchUpgradeGuidesError(
    `the registry gives no integrity and no shasum for ${label}, so its tarball cannot be checked`,
  );
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

/** Each regular file in a tar archive, with its path. Links and folders are skipped. */
export function* tarFiles(archive) {
  let offset = 0;
  let longPath;
  while (offset + 512 <= archive.length) {
    const block = archive.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) return;
    const size = Number.parseInt(text(block, 124, 12).trim() || '0', 8);
    if (!Number.isSafeInteger(size) || offset + 512 + size > archive.length) {
      throw new FetchUpgradeGuidesError('the tarball has an entry that is cut short or unreadable');
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

/** Writes the `skills/prisma-8/` tree of a gzipped package tarball into `destination`. */
export async function extractSkill(tarball, destination) {
  let archive;
  try {
    archive = gunzipSync(tarball);
  } catch {
    throw new FetchUpgradeGuidesError('the tarball is not a gzip archive');
  }
  const inside = `skills/${SKILL_NAME}/`;
  const root = resolve(destination);
  const files = [];
  for (const { path, content } of tarFiles(archive)) {
    const withinPackage = path.replaceAll('\\', '/').split('/').slice(1).join('/');
    if (!withinPackage.startsWith(inside)) continue;
    const relative = withinPackage.slice(inside.length);
    if (relative === '' || relative.endsWith('/')) continue;
    const target = resolve(root, ...relative.split('/'));
    if (
      isAbsolute(relative) ||
      relative.split('/').includes('..') ||
      !target.startsWith(root + sep)
    ) {
      throw new FetchUpgradeGuidesError(`the tarball has an entry outside its folder: ${path}`);
    }
    files.push({ target, content });
  }
  if (files.length === 0) {
    throw new FetchUpgradeGuidesError(`the tarball has no skills/${SKILL_NAME}/ folder`);
  }
  for (const { target, content } of files) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function isExecutableFile(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The package manager command that ships with Node, found on PATH. On Windows its `.cmd` shim is
 * replaced by running the script behind it with Node, so no value passes through a shell.
 */
export function findPackageManager(env, platform) {
  const windows = platform === 'win32';
  const dirs = (lookUp(env, 'PATH') ?? '').split(windows ? ';' : ':').filter((dir) => dir !== '');
  for (const dir of dirs) {
    if (windows) {
      const cli = join(dir, 'node_modules', PACKAGE_MANAGER, 'bin', `${PACKAGE_MANAGER}-cli.js`);
      if (isFile(join(dir, `${PACKAGE_MANAGER}.cmd`)) && isFile(cli)) {
        return { command: process.execPath, args: [cli] };
      }
    } else if (isExecutableFile(join(dir, PACKAGE_MANAGER))) {
      return { command: join(dir, PACKAGE_MANAGER), args: [] };
    }
  }
  return undefined;
}

function toolFailure(error) {
  try {
    const parsed = JSON.parse(String(error.stdout ?? '')).error;
    if (parsed !== undefined) return { code: parsed.code, summary: String(parsed.summary ?? '') };
  } catch {}
  const lines = String(error.stderr ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${PACKAGE_MANAGER} error `))
    .map((line) => line.slice(PACKAGE_MANAGER.length + 7))
    .filter((line) => !line.startsWith('A complete log'));
  const code = /^code (\S+)/.exec(lines[0] ?? '')?.[1];
  return { code, summary: lines.filter((line) => !line.startsWith('code ')).join(' ') };
}

function describeToolFailure({ code, summary }, subcommand, what) {
  if (code === 'E404') return `${what} was not found on the registry: ${summary}`;
  if (code === 'E401' || code === 'E403' || code === 'ENEEDAUTH') {
    return `the registry refused ${what} (${code}): ${summary}. If it needs a login, log in with \`${PACKAGE_MANAGER} login\` and run this again`;
  }
  if (code === 'EINTEGRITY')
    return `the tarball of ${what} does not match its integrity: ${summary}`;
  if (NETWORK_CODES.has(code) || /FetchError|ECONNREFUSED|ENOTFOUND/.test(summary)) {
    return `could not reach the registry to read ${what}: ${summary}`;
  }
  return `\`${PACKAGE_MANAGER} ${subcommand}\` failed for ${what}${code === undefined ? '' : ` (${code})`}: ${summary || 'no message'}`;
}

function commandSource(tool, { packageName, registry, projectDir }) {
  const common = ['--loglevel=error', '--update-notifier=false'];
  if (registry !== undefined) common.push('--registry', registry);
  const runTool = (subcommand, args, what) =>
    new Promise((resolvePromise, reject) => {
      execFile(
        tool.command,
        [...tool.args, subcommand, ...args, ...common],
        { cwd: projectDir, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (error === null) {
            resolvePromise(stdout);
            return;
          }
          if (typeof error.code === 'string') {
            reject(
              new FetchUpgradeGuidesError(
                `could not run \`${PACKAGE_MANAGER}\` (${error.code}): ${error.message}`,
              ),
            );
            return;
          }
          reject(
            new FetchUpgradeGuidesError(
              describeToolFailure(toolFailure({ stdout, stderr }), subcommand, what),
            ),
          );
        },
      );
    });
  const parse = (output, what) => {
    try {
      return output.trim() === '' ? undefined : JSON.parse(output);
    } catch {
      throw new FetchUpgradeGuidesError(
        `\`${PACKAGE_MANAGER}\` did not answer with JSON for ${what}`,
      );
    }
  };
  return {
    async versions() {
      const listed = parse(
        await runTool('view', [packageName, 'versions', '--json', '--prefer-online'], packageName),
        packageName,
      );
      return Array.isArray(listed) ? listed : listed === undefined ? [] : [String(listed)];
    },
    async isDeprecated(version) {
      const label = `${packageName}@${version}`;
      const message = parse(await runTool('view', [label, 'deprecated', '--json'], label), label);
      return message !== undefined && message !== '';
    },
    async tarball(version, folder) {
      const label = `${packageName}@${version}`;
      const output = await runTool(
        'pack',
        [label, '--pack-destination', folder, '--json', '--ignore-scripts', '--prefer-online'],
        label,
      );
      const filename = parse(output, label)?.[0]?.filename;
      const packed =
        typeof filename === 'string'
          ? filename
          : (await readdir(folder)).find((name) => name.endsWith('.tgz'));
      if (packed === undefined) {
        throw new FetchUpgradeGuidesError(
          `\`${PACKAGE_MANAGER} pack\` wrote no tarball for ${label}`,
        );
      }
      return readFile(join(folder, packed));
    },
  };
}

function describeFailure(error) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
  const code = cause === undefined ? undefined : Reflect.get(cause, 'code');
  return typeof code === 'string' ? code : (cause ?? error).message;
}

async function download(url, what, accept) {
  try {
    const response = await fetch(url, {
      headers: { accept },
      signal: AbortSignal.timeout(TIMEOUT_MILLIS),
    });
    if (response.status === 404) {
      throw new FetchUpgradeGuidesError(`${what} was not found at ${url}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new FetchUpgradeGuidesError(
        `${url} answered ${response.status} ${response.statusText} for ${what}. The built-in download sends no credentials, so put the \`${PACKAGE_MANAGER}\` command on PATH, log in to the registry with it, and run this again`,
      );
    }
    if (!response.ok) {
      throw new FetchUpgradeGuidesError(
        `${url} answered ${response.status} ${response.statusText} for ${what}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof FetchUpgradeGuidesError) throw error;
    throw new FetchUpgradeGuidesError(
      `could not reach ${url} to read ${what}: ${describeFailure(error)}`,
    );
  }
}

function builtInSource({ packageName, registry }) {
  const base = registry.replace(/\/+$/, '');
  const url = `${base}/${packageName.replace('/', '%2f')}`;
  let packument;
  const metadata = async () => {
    if (packument !== undefined) return packument;
    const body = await download(
      url,
      packageName,
      'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
    );
    try {
      packument = JSON.parse(body.toString('utf-8'));
    } catch {
      throw new FetchUpgradeGuidesError(`${url} did not answer with package metadata`);
    }
    if (typeof packument !== 'object' || packument === null) {
      throw new FetchUpgradeGuidesError(`${url} did not answer with package metadata`);
    }
    return packument;
  };
  const manifest = async (version) => (await metadata()).versions?.[version] ?? {};
  return {
    async versions() {
      return Object.keys((await metadata()).versions ?? {});
    },
    async isDeprecated(version) {
      const { deprecated } = await manifest(version);
      return typeof deprecated === 'string' && deprecated !== '';
    },
    async tarball(version) {
      const label = `${packageName}@${version}`;
      const dist = (await manifest(version)).dist ?? {};
      if (typeof dist.tarball !== 'string') {
        throw new FetchUpgradeGuidesError(`${base} gives no tarball for ${label}`);
      }
      const content = await download(dist.tarball, `the tarball of ${label}`, '*/*');
      checkIntegrity(content, dist, label);
      return content;
    },
  };
}

function folderBase(packageName) {
  return packageName.replace(/^@/, '').replace('/', '-');
}

async function removeOtherVersions(root, packageName, keep) {
  const prefix = `${folderBase(packageName)}-`;
  for (const entry of await readdir(root)) {
    const version = entry.slice(prefix.length);
    if (entry !== keep && entry.startsWith(prefix) && releaseOrder(version) !== undefined) {
      await rm(join(root, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Finds the newest release of `packageName` (in `major`, when given), downloads it through
 * `source`, and extracts its skill into `<root>/<name>-<version>/prisma-8`.
 */
export async function fetchUpgradeGuides({ packageName, major, root, source }) {
  const candidates = releaseCandidates(await source.versions(), major);
  const chosen = await chooseRelease(candidates, (version) => source.isDeprecated(version));
  if (chosen === undefined) {
    const which = major === undefined ? 'release' : `${major}.x release`;
    throw new FetchUpgradeGuidesError(`${packageName} has no published ${which}`);
  }
  const name = `${folderBase(packageName)}-${chosen.version}`;
  const download = await mkdtemp(join(root, `.download-${name}-`));
  const partial = await mkdtemp(join(root, `.partial-${name}-`));
  try {
    const tarball = await source.tarball(chosen.version, download);
    await extractSkill(tarball, join(partial, SKILL_NAME));
    const folder = join(root, name);
    await rm(folder, { recursive: true, force: true });
    await rename(partial, folder);
  } finally {
    await rm(download, { recursive: true, force: true });
    await rm(partial, { recursive: true, force: true });
  }
  await removeOtherVersions(root, packageName, name);
  return { ...chosen, folder: join(root, name, SKILL_NAME) };
}

function parseArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        major: { type: 'string' },
        registry: { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error) {
    throw new FetchUpgradeGuidesError(`${error.message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new FetchUpgradeGuidesError(USAGE);
  if (values.major !== undefined && !/^\d+$/.test(values.major)) {
    throw new FetchUpgradeGuidesError(`--major "${values.major}" is not a major version number`);
  }
  return {
    packageName: positionals[0],
    major: values.major === undefined ? undefined : Number(values.major),
    registry: values.registry,
    out: values.out,
  };
}

function proxyIsIgnored(env) {
  const proxy = ['HTTPS_PROXY', 'HTTP_PROXY'].some((name) => lookUp(env, name) !== undefined);
  return proxy && env.NODE_USE_ENV_PROXY === undefined;
}

async function main() {
  const { packageName, major, registry, out } = parseArguments(process.argv.slice(2));
  const tool = findPackageManager(process.env, process.platform);
  if (tool === undefined && proxyIsIgnored(process.env)) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } },
    );
    process.exitCode = child.status ?? 1;
    return;
  }
  const projectDir = process.cwd();
  const root = resolve(out ?? join(projectDir, DEFAULT_FOLDER));
  await mkdir(root, { recursive: true });
  if (out === undefined) await writeFile(join(root, '.gitignore'), '*\n');
  const source =
    tool === undefined
      ? builtInSource({
          packageName,
          registry:
            registry ??
            (await configuredRegistry({
              packageName,
              projectDir,
              homeDir: homedir(),
              env: process.env,
            })),
        })
      : commandSource(tool, { packageName, registry, projectDir });
  const { version, deprecated, folder } = await fetchUpgradeGuides({
    packageName,
    major,
    root,
    source,
  });
  if (deprecated) {
    process.stderr.write(
      `Every candidate release of ${packageName} is deprecated, so this used the newest, ${version}.\n`,
    );
  }
  process.stderr.write(
    `Extracted the ${SKILL_NAME} skill of ${packageName}@${version} into ${folder}\n`,
  );
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
      error instanceof FetchUpgradeGuidesError
        ? error.message
        : `unexpected failure: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`fetch-upgrade-guides: ${message}\n`);
    process.exitCode = 1;
  });
}
