/**
 * The `package.json` lines `init` writes for a target package and the `@prisma/orm-*` packages it
 * names, read from how the installed target package names those packages as peers.
 */
export interface VersionLines {
  readonly target: string;
  /** The line for a `@prisma/orm-*` package a manifest names at `range`. */
  readonly ormPackage: (range: string) => string;
  /** Whether a line the project already lists stands for `written`, the line `init` writes. */
  readonly standsFor: (line: string, written: string, installed: string | undefined) => boolean;
}

const EXACT_VERSION = /^[v=]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const RANGE = /^([~^])(\d+)\.(\d+)\./;
const RELEASE = /^[v=]?(\d+)\.(\d+)\./;

/**
 * The version a spec names when it is one exact version, in one form (`v8.0.0` and `=8.0.0` read
 * as `8.0.0`), so a required version, a `package.json` line and an installed version compare as
 * equal when they name the same version; `undefined` for a range or any other spec.
 */
export function exactVersionOf(spec: string): string | undefined {
  return EXACT_VERSION.exec(spec.trim())?.[1];
}

/**
 * A target package that names its `@prisma/orm-*` peers at exact versions, as on the `8.0.0`
 * release candidates and in a development build, gets those versions; inside this repository a
 * `workspace:` specifier on an exact version counts as one. One that names them with ranges gets
 * each peer at the range it names, so `init` never asks for a version the target package refuses,
 * and the target package itself at a range of the same kind on its installed version: a tilde
 * beside tilde peers, as every target package of ours names its platform packages, so an update
 * keeps all the lines on one release; a caret only when every peer is a caret and the target
 * package's version has no pre-release part, since a caret on a pre-release never selects the next
 * minor's.
 */
export function versionLines(
  targetVersion: string,
  ormPeerRanges: readonly string[],
): VersionLines {
  if (ormPeerRanges.every((range) => EXACT_VERSION.test(range.trim().replace(/^workspace:/, '')))) {
    return { target: targetVersion, ormPackage: (range) => range, standsFor: lineStandsFor };
  }
  const caret =
    !targetVersion.includes('-') && ormPeerRanges.every((range) => range.trim().startsWith('^'));
  return {
    target: `${caret ? '^' : '~'}${targetVersion}`,
    ormPackage: (range) => range,
    standsFor: lineStandsFor,
  };
}

/**
 * Whether a required peer's version or range admits an installed version, judged by its operator:
 * an exact version only itself, a tilde any version of the release it starts at (its major and
 * minor), and a caret any version of its major from that minor on. `undefined` for any other range,
 * which this cannot judge; the installed copy then decides.
 */
export function requirementAdmits(requirement: string, version: string): boolean | undefined {
  const exact = exactVersionOf(requirement);
  if (exact !== undefined) return exact === (exactVersionOf(version) ?? version);
  const range = RANGE.exec(requirement.trim());
  const installed = RELEASE.exec(version.trim());
  if (range === null) return undefined;
  if (installed === null) return false;
  const [, operator, major, minor] = range;
  const [, installedMajor, installedMinor] = installed;
  if (Number(installedMajor) !== Number(major)) return false;
  return operator === '~'
    ? Number(installedMinor) === Number(minor)
    : Number(installedMinor) >= Number(minor);
}

/**
 * Whether a line the project already lists stands for `written`, the line `init` writes, by one
 * rule for every required peer. The written line stands for itself. An exact line stands when the
 * requirement admits that version, since the next clean install follows the line whatever is
 * installed now. Any other line (a range, a dist-tag, or a `workspace:`, `catalog:`, `link:`,
 * `file:` or alias line) cannot be judged from its text, so the installed copy decides, and with
 * nothing installed it counts as standing.
 */
function lineStandsFor(line: string, written: string, installed: string | undefined): boolean {
  if (line.trim() === written) return true;
  if (exactVersionOf(line) !== undefined) return requirementAdmits(written, line) !== false;
  if (installed === undefined) return true;
  return requirementAdmits(written, installed) === true;
}
