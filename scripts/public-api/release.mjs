// The release rules the checks against the last release share: which release is the last one,
// how versions are ordered, which exports are exempt, and how the registry is read.
//
// The last release follows docs/oss/versioning.md: the root package.json `version` on a ref is the
// version published from it, and every package carries it. So the last release is the version at
// the pull request's base, or, while a release bump has merged and its tag is not yet pushed, the
// newest release tag below it. Dev builds (`-dev.`) are not releases. The registry is not asked
// for its `latest`, which a yanked release or a rewritten dist-tag would move; it is asked only
// whether each package was published at that version, and for its tarball.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REGISTRY = 'https://registry.npmjs.org';
const IDENTIFIERS = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
const VERSION = new RegExp(
  `^(\\d+)\\.(\\d+)\\.(\\d+)(?:-(${IDENTIFIERS}))?(?:\\+${IDENTIFIERS})?$`,
);
const EXEMPT_PREFIXES = ['rc_', 'preview_', 'ea_', 'Rc_', 'Preview_', 'Ea_'];
const NETWORK_ATTEMPTS = 3;

export class LastReleaseError extends Error {}

export const isVersion = (version) => VERSION.test(version);
export const isDevBuild = (version) => /(^|[.-])dev\./.test(VERSION.exec(version)?.[4] ?? '');
export const isExemptExport = (name) => EXEMPT_PREFIXES.some((prefix) => name.startsWith(prefix));

function parse(version) {
  const match = VERSION.exec(version);
  if (!match) throw new LastReleaseError(`${version} is not a version`);
  return {
    core: match.slice(1, 4),
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

const isNumeric = (identifier) => /^\d+$/.test(identifier);
// Digits compared exactly, however many there are.
const compareNumbers = (a, b) => {
  const [x, y] = [BigInt(a), BigInt(b)];
  return x === y ? 0 : x < y ? -1 : 1;
};

// Semver precedence; build metadata is ignored.
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let index = 0; index < 3; index++) {
    const order = compareNumbers(x.core[index], y.core[index]);
    if (order !== 0) return order;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let index = 0; index < Math.min(x.pre.length, y.pre.length); index++) {
    const [p, q] = [x.pre[index], y.pre[index]];
    if (p === q) continue;
    if (isNumeric(p) && isNumeric(q)) return compareNumbers(p, q);
    if (isNumeric(p) !== isNumeric(q)) return isNumeric(p) ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const gitFailure = (what, error) =>
  new LastReleaseError(`${what} failed: ${String(error.stderr || error.message).trim()}`);

// The ref the pull request merges into: GitHub's base branch in CI, otherwise origin/main or main.
export function baseRef(root, env = process.env) {
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  for (const ref of ['origin/main', 'main']) {
    try {
      git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root);
      return ref;
    } catch {}
  }
  throw new LastReleaseError('neither origin/main nor main exists; fetch the base branch');
}

export function versionAtRef(root, ref) {
  let manifest;
  try {
    manifest = JSON.parse(git(['show', `${ref}:package.json`], root));
  } catch (error) {
    throw gitFailure(`reading package.json at ${ref}`, error);
  }
  if (typeof manifest.version !== 'string' || !isVersion(manifest.version)) {
    throw new LastReleaseError(`the root package.json at ${ref} has no version`);
  }
  return manifest.version;
}

// The release tags on origin, as versions. `git ls-remote` is tried again when it fails, which on
// a CI runner is a network failure.
export async function releaseTags(root, { attempts = NETWORK_ATTEMPTS, retryDelayMs = 2000 } = {}) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return git(['ls-remote', '--tags', '--refs', 'origin', 'refs/tags/v*'], root)
        .split('\n')
        .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\/v/, ''))
        .filter((version) => version !== undefined && isVersion(version) && !isDevBuild(version));
    } catch (error) {
      failure = error;
    }
    if (attempt < attempts) await sleep(retryDelayMs * attempt);
  }
  throw gitFailure(`git ls-remote origin, after ${attempts} attempts,`, failure);
}

// The newest release at or below the version at the base ref, and its tag.
export async function lastRelease({
  root,
  base = baseRef(root),
  versionAt = versionAtRef,
  tags = releaseTags,
}) {
  const baseVersion = versionAt(root, base);
  const released = (await tags(root)).filter(
    (version) => compareVersions(version, baseVersion) <= 0,
  );
  if (released.length === 0) {
    throw new LastReleaseError(
      `origin has no release tag at or below ${baseVersion}, the version at ${base}`,
    );
  }
  const version = released.sort(compareVersions).at(-1);
  return { version, tag: `v${version}`, base, baseVersion };
}

const describeError = (error) =>
  error?.cause?.message
    ? `${error.message} (${error.cause.message})`
    : String(error?.message ?? error);

// A request to the registry, read by `read`, or undefined when the registry has nothing there. It
// is tried again, after a wait that grows with each attempt, when it does not reach the registry,
// when the registry answers with a server error or asks it to slow down (429), or when the answer
// breaks off while it is read.
async function requestRegistry(
  url,
  { what = url, read, init, fetchImpl = fetch, attempts = NETWORK_ATTEMPTS, retryDelayMs = 2000 },
) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(retryDelayMs * (attempt - 1));
    let response;
    try {
      response = await fetchImpl(url, init);
      if (response.status === 404) return undefined;
      if (response.ok) return await read(response);
    } catch (error) {
      failure = describeError(error);
      continue;
    }
    if (response.status < 500 && response.status !== 429) {
      throw new LastReleaseError(
        `could not read ${what} from the registry: it answered ${response.status}`,
      );
    }
    failure = `it answered ${response.status}`;
  }
  throw new LastReleaseError(
    `could not read ${what} from the registry after ${attempts} attempts: ${failure}`,
  );
}

// The registry's abbreviated metadata of a package, or undefined when it has none.
export function fetchPackument(name, options = {}) {
  return requestRegistry(`${REGISTRY}/${name.replace('/', '%2f')}`, {
    ...options,
    what: name,
    read: (response) => response.json(),
    init: { headers: { accept: 'application/vnd.npm.install-v1+json' } },
  });
}

// The published tarball of a package at a version, checked against the integrity the registry
// lists, or undefined when the registry has no such version.
export async function fetchReleaseTarball(
  name,
  version,
  { packument = fetchPackument, ...options } = {},
) {
  const dist = (await packument(name))?.versions?.[version]?.dist;
  if (dist === undefined) return undefined;
  const tarball = String(dist.tarball);
  if (!tarball.startsWith(`${REGISTRY}/`)) {
    throw new LastReleaseError(`${name}@${version}: the tarball ${tarball} is not on the registry`);
  }
  const integrity = /^(sha1|sha256|sha384|sha512)-(\S+)/.exec(String(dist.integrity ?? ''));
  if (integrity === null) {
    throw new LastReleaseError(
      `${name}@${version}: the registry lists no integrity for its tarball`,
    );
  }
  const bytes = await requestRegistry(tarball, {
    ...options,
    read: async (response) => Buffer.from(await response.arrayBuffer()),
  });
  if (bytes === undefined) {
    throw new LastReleaseError(`${name}@${version}: the registry has no tarball at ${tarball}`);
  }
  const [, algorithm, expected] = integrity;
  if (createHash(algorithm).update(bytes).digest('base64') !== expected) {
    throw new LastReleaseError(`${name}@${version}: the tarball does not match its integrity`);
  }
  return bytes;
}

export async function isReleased(name, version, packument = fetchPackument) {
  return (await packument(name))?.versions?.[version] !== undefined;
}

// Fetches the release's tag unless the repository has it. A shallow clone, as in CI, fetches only
// that commit; a full clone fetches it with its history, so that it does not become shallow.
export function fetchReleaseTag(tag, root) {
  const ref = `refs/tags/${tag}`;
  try {
    git(['rev-parse', '--quiet', '--verify', `${ref}^{commit}`], root);
    return;
  } catch {}
  const shallow = git(['rev-parse', '--is-shallow-repository'], root).trim() === 'true';
  try {
    git(
      ['fetch', '--no-tags', ...(shallow ? ['--depth', '1'] : []), 'origin', `${ref}:${ref}`],
      root,
    );
  } catch (error) {
    throw gitFailure(`git fetch of ${tag}`, error);
  }
}

// The names of the published packages at the release's tag, from their package.json files.
export function packagesAtTag(tag, root) {
  const files = git(['ls-tree', '-r', '--name-only', tag, '--', 'packages/9-public/@prisma'], root)
    .split('\n')
    .filter((file) => /^packages\/9-public\/@prisma\/[^/]+\/package\.json$/.test(file));
  return files.map((file) => JSON.parse(git(['show', `${tag}:${file}`], root)).name).sort();
}
