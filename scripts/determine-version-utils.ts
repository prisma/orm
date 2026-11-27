// This module is intentionally pure. All npm/dist-tag I/O and filesystem
// reads live in the callers (`scripts/determine-version.ts`,
// `scripts/bump-version.ts`); this file is reserved for deterministic
// helpers exercised under `node --test` from `pnpm test:scripts`.

import {
  formatVersion,
  isPublishedReleaseCandidate,
  type ParsedVersion,
  parseVersion,
  releaseOfRootVersion,
} from '../packages/0-shared/publish-surface/src/release-plan.ts';

/**
 * Given the current version, computes the next minor's zero-patch
 * form: `0.7.0` -> `0.8.0`, `1.2.5` -> `1.3.0`. Pure / deterministic.
 * Pre-release suffixes on the input are ignored (`0.7.0-foo` -> `0.8.0`).
 */
export function computeNextMinor(current: string): string {
  const { major, minor } = parseVersion(current);
  return `${major}.${minor + 1}.0`;
}

/**
 * Computes the next release version from the current base
 * (see docs/oss/releasing.md):
 *
 * - `8.0.0-rc.N` -> `8.0.0-rc.N+1` — the RC line advances its counter.
 * - pre-8 stable (`0.17.0`) -> `8.0.0-rc.1` — the one-time transition
 *   onto the v8 RC line; there are no further `0.x` minors.
 * - stable `>= 8` -> next minor: `8.0.1` -> `8.1.0`.
 */
export function computeNextReleaseVersion(current: string): string {
  assertCanonicalBase(current);
  const parsed = parseVersion(current);
  if (parsed.level?.name === 'rc') {
    return `8.0.0-rc.${parsed.level.counter + 1}`;
  }
  if (parsed.major < 8) {
    return '8.0.0-rc.1';
  }
  return computeNextMinor(current);
}

export interface VersionResult {
  version: string;
  tag: string;
  devVersion?: string;
}

export type PreviousVersionLookup =
  | { available: true; version: string | undefined }
  | { available: false };

/**
 * The publish plan for a push to `main`. A changed root version means
 * the push is a release bump: publish `<base>` under `latest`, plus a
 * `<base>-dev.N` follow-up so the `dev` dist-tag never falls behind
 * `latest`. An unchanged (or unreadable — a transient git error must
 * never silently promote to `latest`) previous version means the usual
 * dev-only publish. Adopted from prisma/composer#241.
 */
export function planPushPublish(
  base: string,
  previous: PreviousVersionLookup,
  latestDevVersion: string | undefined,
): VersionResult {
  const isReleaseBump = previous.available && previous.version !== base;
  if (isReleaseBump) {
    return {
      version: base,
      tag: 'latest',
      devVersion: composeDevVersion(base, latestDevVersion).version,
    };
  }
  return composeDevVersion(base, latestDevVersion);
}

/**
 * The publish plan for a `workflow_dispatch`. A real (non-dry-run)
 * `latest` dispatch is the recovery path for a failed release publish,
 * so it carries the same `<base>-dev.N` follow-up as a release push —
 * recovering the release must also recover the `dev` dist-tag.
 * Dry runs and non-`latest` dispatches publish only the requested tag.
 */
export function planDispatchPublish(
  base: string,
  tag: string,
  isDryRun: boolean,
  latestDevVersion: string | undefined,
): VersionResult {
  if (tag === 'latest' && !isDryRun) {
    return {
      version: base,
      tag,
      devVersion: composeDevVersion(base, latestDevVersion).version,
    };
  }
  return { version: base, tag };
}

/**
 * Composes the `<base>-dev.N` version for a routine (non-release) push, given
 * the version the anchor package has under the `dev` dist-tag. Every package
 * is published as `<its planned version>-dev.N` with one counter, so the
 * counter must never repeat for a version any package still has. On the
 * release candidates it resets when the root version moves, since every
 * package moves with it. After them it never resets: a package with its own
 * version keeps that version across releases, so a counter that restarted at
 * a new minor would publish its old development versions again. A development
 * build with a suffix the repository does not publish stops here, naming it.
 */
export function composeDevVersion(
  baseVersion: string,
  latestDevVersion: string | undefined,
): VersionResult {
  let buildNumber = 1;

  if (latestDevVersion) {
    const latest = parseVersion(latestDevVersion);
    if (
      latest.dev !== undefined &&
      counterLine(latest) === counterLine(parseVersion(baseVersion))
    ) {
      buildNumber = latest.dev + 1;
    }
  }

  return {
    version: `${baseVersion}-dev.${buildNumber}`,
    tag: 'dev',
  };
}

/**
 * The run of development builds a version's counter belongs to: the whole version on the `8.0.0`
 * release candidates, the major and minor before Prisma 8, and one run for every release after the
 * release candidates.
 */
function counterLine(version: ParsedVersion): string {
  if (isPublishedReleaseCandidate(version)) return formatVersion({ ...version, dev: undefined });
  return version.major < 8 ? `${version.major}.${version.minor}` : 'levels';
}

/**
 * Asserts that a base version is canonical: a clean pre-8 release
 * (`major.minor.patch`), or a Prisma 8 root version as
 * `releaseOfRootVersion` defines it (`8.0.0-rc.N` with N ≥ 1, `8.0.1`, then
 * `X.Y.0`), with no development suffix. Used to fail-fast in the publish
 * workflow if root `package.json` was edited to something other than a
 * release shape; without this guard, a malformed root would compose
 * nonsense publish versions like `0.7.0-foo-dev.1`.
 */
export function assertCanonicalBase(base: string): void {
  let parsed: ParsedVersion | undefined;
  try {
    parsed = parseVersion(base);
  } catch {
    parsed = undefined;
  }
  if (
    parsed === undefined ||
    parsed.dev !== undefined ||
    (parsed.major < 8 && parsed.level !== undefined)
  ) {
    throw new Error(
      `Base version "${base}" is not canonical. ` +
        'The root package.json `version` must be a clean release shape ("0.7.0") ' +
        'or a Prisma 8 root version ("8.0.0-rc.N" with N >= 1, "8.0.1", then "X.Y.0"); nothing else is permitted on `main`.',
    );
  }
  if (parsed.major < 8) return;
  try {
    releaseOfRootVersion(base);
  } catch (cause) {
    throw new Error(
      `Base version "${base}" is not canonical: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
