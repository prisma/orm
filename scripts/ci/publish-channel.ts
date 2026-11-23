/**
 * Two publishers share the npm package `prisma`. prisma/prisma-cli (Prisma 8) owns its `latest`, `dev` and `next`
 * tags, so this branch (Prisma 7) publishes `prisma` under `prev` where other packages get `latest`, and under
 * `prev-dev` where other packages get `dev`. The `@prisma/*` packages have no Prisma 8 version, so their tags are
 * unchanged. Revisit these names when Prisma 9 ships and 8.x needs `prev`.
 */
const PRISMA_DIST_TAGS: ReadonlyMap<string, string> = new Map([
  ['latest', 'prev'],
  ['dev', 'prev-dev'],
])

const PRISMA_MAJOR = 7

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
  return { kind: 'dev', tag: 'dev' }
}

/**
 * Returns the npm dist-tag to publish `pkgName` under. Every publish goes through this, including a custom dist tag.
 * Throws if `prisma` would land on a tag prisma/prisma-cli owns.
 */
export function getPackageDistTag(pkgName: string, tag: string): string {
  if (pkgName !== 'prisma') return tag
  const prismaTag = PRISMA_DIST_TAGS.get(tag) ?? tag
  if (prismaTag === 'next') {
    throw new Error(
      `Refusing to publish prisma under the "next" dist-tag: prisma/prisma-cli owns it for Prisma 8. Prisma 7 uses "prev" and "prev-dev".`,
    )
  }
  return prismaTag
}

/**
 * Returns a custom dist-tag as npm will receive it. The tag reaches `pnpm publish --tag` through a shell, which drops
 * surrounding whitespace, so ` dev` would pass a comparison with `dev` and still publish under it.
 */
export function parseCustomDistTag(input: string): string {
  const tag = input.trim()
  if (!/^[a-z][a-z0-9._-]*$/.test(tag)) {
    throw new Error(`"${input}" is not a usable npm dist-tag: use lowercase letters, digits, ".", "_" and "-".`)
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
