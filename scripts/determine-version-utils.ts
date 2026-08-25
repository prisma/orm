// This module is intentionally pure. All npm/dist-tag I/O and filesystem
// reads live in the callers (`scripts/determine-version.ts`,
// `scripts/bump-version.ts`); this file is reserved for deterministic
// helpers exercised under `node --test` from `pnpm test:scripts`.

const NUM = '(0|[1-9]\\d*)';
const STABLE_BASE_PATTERN = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}$`);
// The one supported RC line (docs/oss/versioning.md): `8.0.0-rc.N`,
// counting from rc.1. Deliberately not a general X.Y.Z-rc.N shape — this
// is a publish guard, and a base like `9.2.3-rc.1` or `8.0.0-rc.0`
// reaching the pipeline is a mistake to fail on, not a case to support.
// A future RC line widens this constant.
const RC_BASE_PATTERN = /^8\.0\.0-rc\.([1-9]\d*)$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses a semver-shaped version string into its numeric components.
 * Tolerant of pre-release suffixes (`0.7.0-foo` parses the same as
 * `0.7.0`); strict on the leading `major.minor.patch` shape — anything
 * else returns NaN-bearing components.
 */
export function parseVersion(version: string): ParsedVersion {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  return { major, minor, patch };
}

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
 * (see docs/oss/versioning.md):
 *
 * - `8.0.0-rc.N` -> `8.0.0-rc.N+1` — the RC line advances its counter.
 * - pre-8 stable (`0.17.0`) -> `8.0.0-rc.1` — the one-time transition
 *   onto the v8 RC line; there are no further `0.x` minors.
 * - stable `>= 8` -> next minor.
 */
export function computeNextReleaseVersion(current: string): string {
  assertCanonicalBase(current);
  const rcMatch = current.match(RC_BASE_PATTERN);
  if (rcMatch) {
    return `8.0.0-rc.${Number(rcMatch[1]) + 1}`;
  }
  if (parseVersion(current).major < 8) {
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
 * Composes the `<base>-dev.N` version for a routine (non-release) push,
 * given the version currently published under the `dev` dist-tag. The
 * counter continues while the base is unchanged and resets to 1 when
 * the base moves (new minor, new rc counter, stable-to-rc transition).
 */
export function composeDevVersion(
  baseVersion: string,
  latestDevVersion: string | undefined,
): VersionResult {
  let buildNumber = 1;

  if (latestDevVersion) {
    const devPattern = /^(\d+\.\d+\.\d+(?:-rc\.\d+)?)-dev\.(\d+)$/;
    const match = latestDevVersion.match(devPattern);

    if (match) {
      const [, devBase, build] = match;
      if (devBase === baseVersion) {
        buildNumber = Number.parseInt(build, 10) + 1;
      }
    }
  }

  return {
    version: `${baseVersion}-dev.${buildNumber}`,
    tag: 'dev',
  };
}

/**
 * Asserts that a base version is canonical: either a clean release
 * (`major.minor.patch`) or a version on the supported RC line
 * (`8.0.0-rc.N`, N ≥ 1). Used to fail-fast in the publish workflow if
 * root `package.json` was edited to something other than a release
 * shape — without this guard, a malformed root would compose nonsense
 * publish versions like `0.7.0-foo-dev.1`.
 */
export function assertCanonicalBase(base: string): void {
  if (!STABLE_BASE_PATTERN.test(base) && !RC_BASE_PATTERN.test(base)) {
    throw new Error(
      `Base version "${base}" is not canonical. ` +
        'The root package.json `version` must be a clean release shape ("0.7.0") ' +
        'or on the supported RC line ("8.0.0-rc.N", N >= 1); nothing else is permitted on `main`.',
    );
  }
}
