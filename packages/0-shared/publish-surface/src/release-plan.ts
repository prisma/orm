/**
 * What each published package is released as, for one release: its version, its dist-tag, and the
 * range it writes on each package of ours it names. Self-contained, with no imports, so a script
 * can load this file directly with Node as well as through the built package.
 */

/** Input a release cannot be planned from; the message names the package and the value. */
export class ReleasePlanError extends Error {}

/** A maturity level below or at general availability. */
export type Level = 'ga' | 'rc' | 'preview' | 'ea';

/** A package's level, or `own-version` for a package numbered outside the release number. */
export type DeclaredLevel = Level | 'own-version';

export type PackageKind = 'facade' | 'platform' | 'extension' | 'library-integration';

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The pre-release level and its counter, as in `-preview.3`; `undefined` for a GA version. */
  readonly level: { readonly name: Exclude<Level, 'ga'>; readonly counter: number } | undefined;
  /** The development build counter, as in `-dev.4`. */
  readonly dev: number | undefined;
}

export interface ReleasePlanInput {
  /** The release's major and minor version. */
  readonly release: { readonly major: number; readonly minor: number };
  /** `release-candidates` while every package is published as `X.Y.0-rc.N`; `levels` after. */
  readonly line: 'release-candidates' | 'levels';
  /** The `N` of `X.Y.0-rc.N` on the release-candidate line. */
  readonly rcCounter: number | undefined;
  /** Each published package's current version. */
  readonly current: Readonly<Record<string, string>>;
  readonly levels: ReadonlyMap<string, DeclaredLevel>;
  readonly kinds: Readonly<Record<string, PackageKind>>;
  /** The packages of ours each package names as a peer dependency. */
  readonly uses: Readonly<Record<string, readonly string[]>>;
  /** The packages that have had a GA release. */
  readonly everGa: ReadonlySet<string>;
  /** The packages that get a fix within the current minor. */
  readonly bump: readonly string[];
  /** The development build counter, for a `-dev.N` build. */
  readonly dev: number | undefined;
}

export interface PlannedPackage {
  readonly version: string;
  readonly tag: string;
  /** The range written on each package of ours this package names. */
  readonly ranges: Readonly<Record<string, string>>;
}

export type ReleasePlan = Readonly<Record<string, PlannedPackage>>;

const LEVEL_ORDER: Readonly<Record<Level, number>> = { ea: 0, preview: 1, rc: 2, ga: 3 };

const NUMBER = '(0|[1-9]\\d*)';
const VERSION = new RegExp(
  `^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(rc|preview|ea)\\.${NUMBER})?(?:-dev\\.${NUMBER})?$`,
);

export function parseVersion(text: string): ParsedVersion {
  const match = VERSION.exec(text);
  if (match === null) {
    throw new ReleasePlanError(
      `"${text}" is not a version this repository publishes: X.Y.Z, optionally followed by -rc.N, -preview.N or -ea.N, and by -dev.N`,
    );
  }
  const [, major, minor, patch, levelName, counter, dev] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    level:
      levelName === 'rc' || levelName === 'preview' || levelName === 'ea'
        ? { name: levelName, counter: Number(counter) }
        : undefined,
    dev: dev === undefined ? undefined : Number(dev),
  };
}

export function formatVersion(version: ParsedVersion): string {
  const level =
    version.level === undefined ? '' : `-${version.level.name}.${version.level.counter}`;
  const dev = version.dev === undefined ? '' : `-dev.${version.dev}`;
  return `${version.major}.${version.minor}.${version.patch}${level}${dev}`;
}

export interface LevelViolation {
  readonly user: string;
  readonly userLevel: DeclaredLevel;
  readonly named: string;
  readonly namedLevel: DeclaredLevel;
}

/**
 * Every pair where a package names one of ours at a lower level than its own, or names an
 * own-version package. An own-version package may name any level.
 */
export function levelViolations(
  levels: ReadonlyMap<string, DeclaredLevel>,
  uses: Readonly<Record<string, readonly string[]>>,
): LevelViolation[] {
  const violations: LevelViolation[] = [];
  for (const [user, named] of Object.entries(uses)) {
    const userLevel = levels.get(user);
    for (const name of named) {
      const namedLevel = levels.get(name);
      if (userLevel === undefined || namedLevel === undefined) continue;
      const refused =
        namedLevel === 'own-version' ||
        (userLevel !== 'own-version' && LEVEL_ORDER[namedLevel] < LEVEL_ORDER[userLevel]);
      if (refused) violations.push({ user, userLevel, named: name, namedLevel });
    }
  }
  return violations;
}

export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const names = Object.keys(input.current);
  checkInput(input, names);
  const versions =
    input.line === 'release-candidates'
      ? candidateVersions(input, names)
      : levelVersions(input, names);
  const plan: Record<string, PlannedPackage> = {};
  for (const name of names) {
    const version = withDev(versions[name] ?? '', input.dev);
    const ranges: Record<string, string> = {};
    for (const named of input.uses[name] ?? []) {
      ranges[named] =
        input.line === 'release-candidates' || input.dev !== undefined
          ? withDev(versions[named] ?? '', input.dev)
          : levelRange(input, name, named);
    }
    plan[name] = { version, tag: tagOf(input, name), ranges };
  }
  return plan;
}

function checkInput(input: ReleasePlanInput, names: readonly string[]): void {
  const { release } = input;
  if (!isCount(release.major) || !isCount(release.minor)) {
    throw new ReleasePlanError(
      `release ${release.major}.${release.minor} is not a major and minor version`,
    );
  }
  if (input.dev !== undefined && !isCount(input.dev)) {
    throw new ReleasePlanError(`dev ${input.dev} is not a development build counter`);
  }
  for (const name of names) {
    if (!input.levels.has(name)) throw new ReleasePlanError(`${name} has no declared level`);
    if (input.kinds[name] === undefined) throw new ReleasePlanError(`${name} has no declared kind`);
    parseCurrent(input, name);
  }
  for (const name of input.levels.keys()) {
    if (!names.includes(name))
      throw new ReleasePlanError(`${name} has a level but no current version`);
  }
  for (const [user, named] of Object.entries(input.uses)) {
    for (const name of [user, ...named]) {
      if (!names.includes(name))
        throw new ReleasePlanError(`uses names ${name}, which is not one of ours`);
    }
  }
  for (const name of input.bump) {
    if (!names.includes(name))
      throw new ReleasePlanError(`bump names ${name}, which is not one of ours`);
  }
  const violations = levelViolations(input.levels, input.uses);
  if (violations.length > 0) {
    throw new ReleasePlanError(
      violations
        .map(
          (v) =>
            `${v.user} (${v.userLevel}) names ${v.named} (${v.namedLevel}): a package may name only packages at its own level or a higher one, and none numbered on its own`,
        )
        .join('\n'),
    );
  }
  if (input.line === 'release-candidates') {
    if (input.rcCounter === undefined || !isCount(input.rcCounter)) {
      throw new ReleasePlanError(
        `rcCounter ${input.rcCounter} is required on the release-candidate line`,
      );
    }
    if (input.bump.length > 0) {
      throw new ReleasePlanError(
        'bump applies on the levels line only; the release candidates move together',
      );
    }
  }
}

function parseCurrent(input: ReleasePlanInput, name: string): ParsedVersion {
  const text = input.current[name] ?? '';
  let parsed: ParsedVersion;
  try {
    parsed = parseVersion(text);
  } catch {
    throw new ReleasePlanError(`${name}: "${text}" is not a version this repository publishes`);
  }
  if (parsed.dev !== undefined) {
    throw new ReleasePlanError(`${name}: "${text}" is a development build, not a released version`);
  }
  return parsed;
}

function candidateVersions(
  input: ReleasePlanInput,
  names: readonly string[],
): Record<string, string> {
  const version = `${input.release.major}.${input.release.minor}.0-rc.${input.rcCounter}`;
  return Object.fromEntries(names.map((name) => [name, version]));
}

/**
 * The first release with levels follows the release candidates, when every package not numbered
 * on its own still holds one `X.Y.0-rc.N` of the release's minor.
 */
function isFirstReleaseWithLevels(input: ReleasePlanInput, names: readonly string[]): boolean {
  const lockstep = names.filter((name) => input.levels.get(name) !== 'own-version');
  const versions = new Set(lockstep.map((name) => input.current[name]));
  if (versions.size !== 1) return false;
  const [only] = [...versions];
  const parsed = only === undefined ? undefined : parseVersion(only);
  return (
    parsed !== undefined &&
    parsed.level?.name === 'rc' &&
    parsed.major === input.release.major &&
    parsed.minor === input.release.minor &&
    parsed.patch === 0
  );
}

function levelVersions(input: ReleasePlanInput, names: readonly string[]): Record<string, string> {
  const { major, minor } = input.release;
  const first = isFirstReleaseWithLevels(input, names);
  const versions: Record<string, string> = {};
  for (const name of names) {
    const level = input.levels.get(name);
    const text = input.current[name] ?? '';
    const current = parseCurrent(input, name);
    if (level === 'own-version') {
      if (
        first &&
        current.level?.name === 'rc' &&
        current.major === major &&
        current.minor === minor
      ) {
        throw new ReleasePlanError(
          `${name}: "${text}" is the release-candidate version; a package numbered on its own needs its own version before the first release with levels`,
        );
      }
      versions[name] = text;
      continue;
    }
    if (level === undefined) throw new ReleasePlanError(`${name} has no declared level`);
    versions[name] = first
      ? firstOfMinor(major, minor, level)
      : nextVersion(name, text, current, level, input);
  }
  return versions;
}

function nextVersion(
  name: string,
  text: string,
  current: ParsedVersion,
  level: Level,
  input: ReleasePlanInput,
): string {
  const { major, minor } = input.release;
  const order = major - current.major || minor - current.minor;
  if (order < 0) {
    throw new ReleasePlanError(
      `${name}: release ${major}.${minor} is older than its current version "${text}"`,
    );
  }
  if (level !== 'ga' && current.level === undefined && major === current.major) {
    throw new ReleasePlanError(
      `${name}: its level is ${level} but its current version "${text}" is GA; a level goes down only at a new major`,
    );
  }
  if (order > 0) return firstOfMinor(major, minor, level);
  if ((current.level?.name ?? 'ga') !== level) {
    throw new ReleasePlanError(
      `${name}: its level is ${level} but its current version "${text}" is not; a level changes only at a new minor`,
    );
  }
  if (!input.bump.includes(name)) return text;
  return formatVersion(
    current.level === undefined
      ? { ...current, patch: current.patch + 1 }
      : { ...current, level: { ...current.level, counter: current.level.counter + 1 } },
  );
}

function firstOfMinor(major: number, minor: number, level: Level): string {
  return level === 'ga' ? `${major}.${minor}.0` : `${major}.${minor}.0-${level}.0`;
}

function levelRange(input: ReleasePlanInput, user: string, named: string): string {
  const level = input.levels.get(named);
  if (level === undefined || level === 'own-version') {
    throw new ReleasePlanError(`${user} names ${named}, which is numbered on its own`);
  }
  const kind = input.kinds[user];
  const operator =
    input.levels.get(user) === 'own-version' ||
    kind === 'extension' ||
    kind === 'library-integration'
      ? '^'
      : '~';
  return `${operator}${firstOfMinor(input.release.major, input.release.minor, level)}`;
}

function tagOf(input: ReleasePlanInput, name: string): string {
  if (input.dev !== undefined) return 'dev';
  const level = input.levels.get(name);
  if (input.line === 'release-candidates' || level === 'ga' || level === 'own-version') {
    return 'latest';
  }
  return input.everGa.has(name) && level !== undefined ? level : 'latest';
}

function withDev(version: string, dev: number | undefined): string {
  return dev === undefined ? version : `${version}-dev.${dev}`;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
