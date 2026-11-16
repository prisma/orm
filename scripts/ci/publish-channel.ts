/**
 * Two publishers share the npm package `prisma`. prisma/prisma-cli (Prisma 8) owns its `latest`, `dev` and `next`
 * tags. This branch (Prisma 7) owns `prev`, `prev-dev`, `patch-dev` and `integration`.
 *
 * The `@prisma/*` packages still get stable releases on `latest` from this branch, so for them `prev-dev` means
 * "Prisma 7 dev build", not "dev line of `prev`". Revisit these names when Prisma 9 ships and 8.x needs `prev`.
 */
export const DEV_DIST_TAG = 'prev-dev'

export const PRISMA_STABLE_DIST_TAG = 'prev'

const PRISMA_MAJOR = 7

const PRISMA_CLI_OWNED_DIST_TAGS: ReadonlySet<string> = new Set(['latest', 'dev', 'next'])

export type PublishChannelInput = {
  branch: string | undefined
  patchBranch: string | null
  releaseVersion: string | undefined
  forceIntegrationRelease: boolean
}

export type PublishChannel = {
  kind: 'integration' | 'patch-dev' | 'release' | 'dev'
  tag: string
  ecosystemTestsBranch?: string
}

export function getPublishChannel({
  branch,
  patchBranch,
  releaseVersion,
  forceIntegrationRelease,
}: PublishChannelInput): PublishChannel {
  if (branch && (forceIntegrationRelease || branch.startsWith('integration/'))) {
    return { kind: 'integration', tag: 'integration' }
  }
  if (patchBranch) {
    return releaseVersion
      ? { kind: 'release', tag: 'latest', ecosystemTestsBranch: 'patch-dev' }
      : { kind: 'patch-dev', tag: 'patch-dev' }
  }
  if (releaseVersion) {
    return { kind: 'release', tag: 'latest', ecosystemTestsBranch: 'dev' }
  }
  return { kind: 'dev', tag: DEV_DIST_TAG }
}

/**
 * Returns the npm dist-tag to publish `pkgName` under. Every publish goes through this, including a custom dist tag.
 * Throws if `prisma` would land on a tag prisma/prisma-cli owns.
 */
export function getPackageDistTag(pkgName: string, tag: string): string {
  if (pkgName !== 'prisma') return tag
  if (tag === 'latest') return PRISMA_STABLE_DIST_TAG
  if (PRISMA_CLI_OWNED_DIST_TAGS.has(tag)) {
    throw new Error(
      `Refusing to publish prisma under the "${tag}" dist-tag: prisma/prisma-cli owns it for Prisma 8. Prisma 7 dev builds use "${DEV_DIST_TAG}".`,
    )
  }
  return tag
}

/**
 * Returns the next minor after the highest stable Prisma 7 version in `publishedVersions`, e.g. `7.10.1` -> `7.11.0`.
 * Reads the version list rather than a dist-tag, because a release from an older patch branch moves `prev` back.
 */
export function getNextMinorStable(publishedVersions: readonly string[]): string {
  const minors = publishedVersions.flatMap((version) => {
    const match = /^(\d+)\.(\d+)\.\d+$/.exec(version.trim())
    return match && Number(match[1]) === PRISMA_MAJOR ? [Number(match[2])] : []
  })
  if (minors.length === 0) {
    throw new Error(
      `Found no stable ${PRISMA_MAJOR}.x.y version of prisma on npm. Dev and integration versions are based on the highest one.`,
    )
  }
  return `${PRISMA_MAJOR}.${Math.max(...minors) + 1}.0`
}
