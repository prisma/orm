/**
 * npm dist-tag for dev builds from the `v7` branch. Not `dev`: prisma/prisma-cli publishes the Prisma 8 `prisma`
 * package under `dev`, and sharing the tag made `prisma@dev` switch between Prisma 7 and Prisma 8 builds.
 */
export const DEV_DIST_TAG = 'prev-dev'

/**
 * npm dist-tag that holds the newest stable Prisma 7 release of `prisma`. `latest` belongs to prisma/prisma-cli.
 */
export const PRISMA_STABLE_DIST_TAG = 'prev'

export type PublishChannelInput = {
  branch: string | undefined
  patchBranch: string | null
  releaseVersion: string | undefined
  forceIntegrationRelease: boolean
}

export type PublishChannel = {
  version: 'integration' | 'patch-dev' | 'release' | 'dev'
  tag: string
  tagForEcosystemTestsCheck?: string
}

export function getPublishChannel({
  branch,
  patchBranch,
  releaseVersion,
  forceIntegrationRelease,
}: PublishChannelInput): PublishChannel {
  if (branch && (forceIntegrationRelease || branch.startsWith('integration/'))) {
    return { version: 'integration', tag: 'integration' }
  }
  if (patchBranch) {
    return releaseVersion
      ? { version: 'release', tag: 'latest', tagForEcosystemTestsCheck: 'patch-dev' }
      : { version: 'patch-dev', tag: 'patch-dev' }
  }
  if (releaseVersion) {
    // Names the `dev` branch of prisma/ecosystem-tests, not an npm dist-tag.
    return { version: 'release', tag: 'latest', tagForEcosystemTestsCheck: 'dev' }
  }
  return { version: 'dev', tag: DEV_DIST_TAG }
}

export function getPackageDistTag(pkgName: string, tag: string): string {
  return pkgName === 'prisma' && tag === 'latest' ? PRISMA_STABLE_DIST_TAG : tag
}

/**
 * Returns the next minor version after the newest stable Prisma 7 release, e.g. `7.10.1` -> `7.11.0`.
 * Throws for a prerelease, which means the dist-tag no longer points at a Prisma 7 stable release.
 */
export function getNextMinorStable(stableVersion: string): string {
  const match = /^(\d+)\.(\d+)\.\d+$/.exec(stableVersion.trim())
  if (!match) {
    throw new Error(
      `Expected prisma@${PRISMA_STABLE_DIST_TAG} to be a stable x.y.z version, got "${stableVersion}". Dev and integration versions are based on it.`,
    )
  }
  return `${match[1]}.${Number(match[2]) + 1}.0`
}
