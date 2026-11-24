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
const RELEASE_NUMBER = /^[~^]?(\d+\.\d+)\./;

/**
 * A target package that names its `@prisma/orm-*` peers at exact versions, as on the `8.0.0`
 * release candidates and in a development build, gets those versions; inside this repository a
 * `workspace:` specifier on an exact version counts as one. One that names them with
 * ranges gets a tilde on every line when its own version has a pre-release part, since a caret on a
 * pre-release never selects the next minor's pre-release, and a caret on every line otherwise, so
 * an update moves them all to the next release together.
 */
export function versionLines(
  targetVersion: string,
  ormPeerRanges: readonly string[],
): VersionLines {
  if (ormPeerRanges.every((range) => EXACT_VERSION.test(range.trim().replace(/^workspace:/, '')))) {
    return { target: targetVersion, ormPackage: (range) => range, standsFor: exactLineStandsFor };
  }
  if (targetVersion.includes('-')) {
    return {
      target: `~${targetVersion}`,
      ormPackage: (range) => range,
      standsFor: rangedLineStandsFor,
    };
  }
  const [major, minor] = targetVersion.split('.');
  return {
    target: `^${major}.${minor}.0`,
    ormPackage: (range) => (range.startsWith('~') ? `^${range.slice(1)}` : range),
    standsFor: rangedLineStandsFor,
  };
}

/**
 * An exact version is judged by its text, since the next clean install follows it whatever is
 * installed now. Any other line (a range, a dist-tag, or a `workspace:`, `catalog:`, `link:`,
 * `file:` or alias line) cannot be judged from its text without resolving it, so the installed
 * copy decides, and with nothing installed it counts as standing for the version.
 */
function exactLineStandsFor(line: string, version: string, installed: string | undefined): boolean {
  const exact = EXACT_VERSION.exec(line.trim());
  if (exact !== null) return exact[1] === version;
  return installed === undefined || installed === version;
}

/**
 * Whether a required peer's version or range admits an installed version: an exact version only
 * itself, and a caret or tilde range any version of the release it starts at, its major and minor.
 * `undefined` for any other range, which this cannot judge.
 */
export function requirementAdmits(requirement: string, version: string): boolean | undefined {
  const exact = EXACT_VERSION.exec(requirement.trim());
  if (exact !== null) return exact[1] === version;
  const release = RELEASE_NUMBER.exec(requirement.trim())?.[1];
  if (release === undefined) return undefined;
  return RELEASE_NUMBER.exec(version)?.[1] === release;
}

/**
 * The line `init` writes stands for itself. Any other line is judged by the installed copy: with
 * nothing installed it counts as standing, and otherwise the copy must be of the release the
 * written range starts at, its major and minor.
 */
function rangedLineStandsFor(
  line: string,
  written: string,
  installed: string | undefined,
): boolean {
  if (line.trim() === written) return true;
  if (installed === undefined) return true;
  return requirementAdmits(written, installed) === true;
}
