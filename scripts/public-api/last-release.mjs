// The last release, which the break checks compare the current build with: the registry's
// `latest` of @prisma/orm-postgres and its git tag. Every package is released with that version;
// a package with no version equal to it has not been released yet. A package's own `latest` is
// not used, because one can be published by hand (@prisma/orm-better-auth's is 0.0.0).

import { execFileSync } from 'node:child_process';

export const REFERENCE_PACKAGE = '@prisma/orm-postgres';
const REGISTRY = 'https://registry.npmjs.org';

export class LastReleaseError extends Error {}

export async function fetchPackument(name) {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new LastReleaseError(`the registry answered ${response.status} for ${name}`);
  }
  return response.json();
}

export function gitTagExists(tag, cwd) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return true;
  } catch (error) {
    if (error.status === 2) return false;
    throw new LastReleaseError(
      `git ls-remote failed: ${String(error.stderr ?? error.message).trim()}`,
    );
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
