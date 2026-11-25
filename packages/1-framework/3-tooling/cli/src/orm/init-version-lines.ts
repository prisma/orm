/**
 * The `package.json` lines `init` writes for a facade and the `@prisma/orm-*` packages it
 * names, read from how the installed facade names those packages as peers.
 */
export interface VersionLines {
  readonly facade: string;
  /** The line for a `@prisma/orm-*` package a manifest names at `range`. */
  readonly ormPackage: (range: string) => string;
}

const EXACT_VERSION = /^[v=]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const RANGE = /^([~^])(\S+)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The version a spec names when it is one exact version, in one form (`v8.0.0` and `=8.0.0` read
 * as `8.0.0`), so a required version, a `package.json` line and an installed version compare as
 * equal when they name the same version; `undefined` for a range or any other spec.
 */
export function exactVersionOf(spec: string): string | undefined {
  return EXACT_VERSION.exec(spec.trim())?.[1];
}

/**
 * A facade that names its `@prisma/orm-*` peers at exact versions, as on the `8.0.0`
 * release candidates and in a development build, gets those versions; inside this repository a
 * `workspace:` specifier counts as the version or range it carries. One that names them with
 * ranges:
 *
 * - When init adds the facade itself, a GA one (a plain version) gets a caret on every line:
 *   each tilde peer as the same version with a caret, and the facade with a caret on the version
 *   its tilde peers name (`~8.0.1` gives `^8.0.1`, `~8.1.0` gives `^8.1.0`), or on its own
 *   version when no peer has a tilde, so an update moves every line to the next release
 *   together. One whose version has a pre-release part gets a
 *   tilde on every line: each peer at its declared range and the facade at a tilde on its
 *   version, since a caret on a pre-release never selects the next minor's.
 * - When the project already lists the facade, its line is the user's, and each peer gets
 *   the range the installed facade declares, so init never installs a platform package
 *   that facade does not accept.
 */
export function versionLines(
  facadeVersion: string,
  ormPeerRanges: readonly string[],
  options: { readonly addsFacade: boolean },
): VersionLines {
  if (ormPeerRanges.every((range) => EXACT_VERSION.test(withoutWorkspaceProtocol(range)))) {
    return { facade: facadeVersion, ormPackage: (range) => range };
  }
  if (!options.addsFacade || facadeVersion.includes('-')) {
    return { facade: `~${facadeVersion}`, ormPackage: (range) => range };
  }
  const peerVersion = ormPeerRanges
    .map((range) => RANGE.exec(withoutWorkspaceProtocol(range)))
    .find((range) => range?.[1] === '~' && !range[2]?.includes('-'))?.[2];
  return {
    facade: `^${peerVersion ?? facadeVersion}`,
    ormPackage: (range) => (range.trim().startsWith('~') ? `^${range.trim().slice(1)}` : range),
  };
}

function withoutWorkspaceProtocol(range: string): string {
  return range.trim().replace(/^workspace:/, '');
}

/**
 * Whether a required peer's version or range admits an installed version, as Semantic Versioning
 * reads it: an exact version only itself; a tilde or a caret any version from the one it names, of
 * the same release (major and minor) for a tilde and of the same major for a caret. A pre-release
 * is admitted only by a range that names a pre-release of the same `X.Y.Z`, so `~8.0.1-ea.0` does
 * not admit `8.0.0-rc.26`. `undefined` for any other range, which this cannot judge; the installed
 * copy then decides.
 */
export function requirementAdmits(requirement: string, version: string): boolean | undefined {
  const exact = exactVersionOf(requirement);
  if (exact !== undefined) return exact === (exactVersionOf(version) ?? version);
  const range = RANGE.exec(requirement.trim());
  if (range === null) return undefined;
  const [, operator, rangeVersion = ''] = range;
  const from = semverOf(rangeVersion);
  const installed = semverOf(exactVersionOf(version) ?? '');
  if (from === undefined) return undefined;
  if (installed === undefined || installed.major !== from.major) return false;
  if (operator === '~' && installed.minor !== from.minor) return false;
  if (
    installed.pre.length > 0 &&
    (from.pre.length === 0 || installed.minor !== from.minor || installed.patch !== from.patch)
  ) {
    return false;
  }
  return compareSemver(installed, from) >= 0;
}

interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: readonly string[];
}

function semverOf(version: string): Semver | undefined {
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  const [, major, minor, patch, pre] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre === undefined ? [] : pre.split('.'),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  const byNumber = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (byNumber !== 0) return byNumber;
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const order = compareIdentifier(a.pre[i] ?? '', b.pre[i] ?? '');
    if (order !== 0) return order;
  }
  return a.pre.length - b.pre.length;
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a line the project already lists stands for `written`, the line `init` writes, by one
 * rule for every required peer. The written line stands for itself. An exact line stands when the
 * requirement admits that version, since the next clean install follows the line whatever is
 * installed now. Any other line (a range, a dist-tag, or a `workspace:`, `catalog:`, `link:`,
 * `file:` or alias line) cannot be judged from its text, so the installed copy decides, and with
 * nothing installed it counts as standing.
 */
export function lineStandsFor(
  line: string,
  written: string,
  installed: string | undefined,
): boolean {
  if (line.trim() === written) return true;
  if (exactVersionOf(line) !== undefined) return requirementAdmits(written, line) !== false;
  if (installed === undefined) return true;
  return requirementAdmits(written, installed) === true;
}
