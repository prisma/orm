// The release rules both checks against the last release share: which release is the last one,
// how versions are ordered, which are pre-releases, and which exports are exempt.
//
// The last release follows docs/oss/versioning.md: the root package.json `version` on a ref is the
// version published from it, and every package carries it. So the last release is the version at
// the pull request's base, or, while a release bump has merged and its tag is not yet pushed, the
// newest release tag below it. Dev builds (`-dev.`) are not releases. The registry is not asked
// for its `latest`, which a yanked release or a rewritten dist-tag would move; it is asked only
// whether each package was published at that version.

import { execFileSync } from 'node:child_process';

const REGISTRY = 'https://registry.npmjs.org';
const IDENTIFIERS = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
const VERSION = new RegExp(
  `^(\\d+)\\.(\\d+)\\.(\\d+)(?:-(${IDENTIFIERS}))?(?:\\+${IDENTIFIERS})?$`,
);
const EXEMPT_PREFIXES = ['rc_', 'preview_', 'ea_'];
const NETWORK_ATTEMPTS = 3;

export class LastReleaseError extends Error {}

export const isVersion = (version) => VERSION.test(version);
export const isPrerelease = (version) => VERSION.exec(version)?.[4] !== undefined;
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

// The registry's abbreviated metadata of a package, or undefined when it has none. A request that
// fails to reach the registry is tried again; an answer that is an error is not.
export async function fetchPackument(
  name,
  { fetchImpl = fetch, attempts = NETWORK_ATTEMPTS, retryDelayMs = 2000 } = {},
) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(`${REGISTRY}/${name.replace('/', '%2f')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      });
    } catch (error) {
      failure = describeError(error);
      if (attempt < attempts) await sleep(retryDelayMs * attempt);
      continue;
    }
    if (response.status === 404) return undefined;
    if (response.ok) return await response.json();
    throw new LastReleaseError(
      `could not read ${name} from the registry: it answered ${response.status}`,
    );
  }
  throw new LastReleaseError(
    `could not read ${name} from the registry after ${attempts} attempts: ${failure}`,
  );
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
