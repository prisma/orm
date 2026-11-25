// The last release, which the break checks compare the current build with: the registry's
// `latest` of @prisma/orm-postgres and its git tag. Every package is released with that version;
// a package with no version equal to it has not been released yet. A package's own `latest` is
// not used, because one can be published by hand (@prisma/orm-better-auth's is 0.0.0).

import { execFileSync } from 'node:child_process';

export const REFERENCE_PACKAGE = '@prisma/orm-postgres';
const REGISTRY = 'https://registry.npmjs.org';

export class LastReleaseError extends Error {}

const describeError = (error) =>
  error?.cause?.message
    ? `${error.message} (${error.cause.message})`
    : String(error?.message ?? error);

// The registry's abbreviated metadata of a package, or undefined when it has none. A failed
// request or a server error is tried again; after the last attempt it ends in a LastReleaseError.
export async function fetchPackument(
  name,
  { fetchImpl = fetch, attempts = 3, retryDelayMs = 2000 } = {},
) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(`${REGISTRY}/${name.replace('/', '%2f')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      });
      if (response.status === 404) return undefined;
      if (response.ok) return await response.json();
      failure = `the registry answered ${response.status}`;
    } catch (error) {
      failure = describeError(error);
    }
    if (attempt < attempts) await new Promise((done) => setTimeout(done, retryDelayMs * attempt));
  }
  throw new LastReleaseError(
    `could not read ${name} from the registry after ${attempts} attempts: ${failure}`,
  );
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const gitFailure = (what, error) =>
  new LastReleaseError(`${what} failed: ${String(error.stderr || error.message).trim()}`);

export function gitTagExists(tag, cwd) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch (error) {
    if (error.status === 2) return false;
    throw gitFailure('git ls-remote', error);
  }
}

export async function lastRelease({ root, packument = fetchPackument, tagExists = gitTagExists }) {
  const version = (await packument(REFERENCE_PACKAGE))?.['dist-tags']?.latest;
  if (typeof version !== 'string') {
    throw new LastReleaseError(`the registry has no latest version of ${REFERENCE_PACKAGE}`);
  }
  const tag = `v${version}`;
  if (!tagExists(tag, root)) {
    throw new LastReleaseError(
      `${REFERENCE_PACKAGE}@${version} is the last release, but the repository has no tag ${tag}`,
    );
  }
  return { version, tag };
}

export async function isReleased(name, version, packument = fetchPackument) {
  return (await packument(name))?.versions?.[version] !== undefined;
}

// Fetches the release's tag unless the repository has it. A shallow clone, as in CI, fetches only
// that commit; a full clone fetches it with its history, so that it does not become shallow.
export function fetchReleaseTag(tag, root) {
  const ref = `refs/tags/${tag}`;
  try {
    git(['rev-parse', '--quiet', '--verify', ref], root);
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
