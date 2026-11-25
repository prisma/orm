/**
 * What each published package is released as, for one release: its version, its dist-tag, and the
 * range it writes on each package of ours it names. Scripts load this file from source, before the
 * workspace is built, so it may import only types; it imports nothing.
 */

/** Input a release cannot be planned from; the message names the package and the value. */
export class ReleasePlanError extends Error {}

/** A maturity level below or at general availability. */
export type Level = 'ga' | 'rc' | 'preview' | 'ea';

/**
 * A package that has its own version, outside the release number, and no level. `firstVersion` is
 * its version at the first release with levels; after that it keeps its version, and a fix to it
 * raises its patch.
 */
export interface OwnVersion {
  readonly firstVersion: string;
}

/** How a package is numbered: by the release number at a level, or with its own version. */
export type Numbering = Level | OwnVersion;

export function hasOwnVersion(numbering: Numbering | undefined): numbering is OwnVersion {
  return typeof numbering === 'object';
}

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
  readonly numbering: ReadonlyMap<string, Numbering>;
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
  readonly userNumbering: Numbering;
  readonly named: string;
  readonly namedNumbering: Numbering;
}

/**
 * Every pair where a package names one of ours at a lower level than its own, or names a package
 * with its own version. A package with its own version may name any level.
 */
export function levelViolations(
  numbering: ReadonlyMap<string, Numbering>,
  uses: Readonly<Record<string, readonly string[]>>,
): LevelViolation[] {
  const violations: LevelViolation[] = [];
  for (const [user, named] of Object.entries(uses)) {
    const userNumbering = numbering.get(user);
    for (const name of named) {
      const namedNumbering = numbering.get(name);
      if (userNumbering === undefined || namedNumbering === undefined) continue;
      const refused =
        hasOwnVersion(namedNumbering) ||
        (!hasOwnVersion(userNumbering) && LEVEL_ORDER[namedNumbering] < LEVEL_ORDER[userNumbering]);
      if (refused) violations.push({ user, userNumbering, named: name, namedNumbering });
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
    if (!input.numbering.has(name))
      throw new ReleasePlanError(`${name} has no declared level or own version`);
    if (input.kinds[name] === undefined) throw new ReleasePlanError(`${name} has no declared kind`);
    parseCurrent(input, name);
  }
  for (const name of input.numbering.keys()) {
    if (!names.includes(name))
      throw new ReleasePlanError(`${name} has a declared numbering but no current version`);
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
  const violations = levelViolations(input.numbering, input.uses);
  if (violations.length > 0) {
    throw new ReleasePlanError(
      violations
        .map(
          (v) =>
            `${v.user} (${describeNumbering(v.userNumbering)}) names ${v.named} (${describeNumbering(v.namedNumbering)}): a package may name only packages at its own level or a higher one, and none with its own version`,
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
 * The first release with levels follows the release candidates, when every package without its own
 * version still holds one `X.Y.0-rc.N` of the release's minor.
 */
function isFirstReleaseWithLevels(input: ReleasePlanInput, names: readonly string[]): boolean {
  const leveled = names.filter((name) => !hasOwnVersion(input.numbering.get(name)));
  const versions = new Set(leveled.map((name) => input.current[name]));
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
    const level = input.numbering.get(name);
    const text = input.current[name] ?? '';
    const current = parseCurrent(input, name);
    if (hasOwnVersion(level)) {
      versions[name] =
        current.level?.name === 'rc'
          ? parseVersionOf(name, level.firstVersion)
          : input.bump.includes(name)
            ? formatVersion({ ...current, patch: current.patch + 1 })
            : text;
      continue;
    }
    if (level === undefined) throw new ReleasePlanError(`${name} has no declared level`);
    versions[name] = first
      ? firstVersionOfMinor({ major, minor }, level)
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
  const currentLevel = current.level?.name ?? 'ga';
  if (currentLevel === 'ga' && level !== 'ga') {
    throw new ReleasePlanError(
      `${name}: its level is ${level} but it is GA at "${text}"; whether a GA package may go below GA again is not decided, so the release scripts do not do it`,
    );
  }
  const first = (): string => firstVersionOfMinor({ major, minor }, level);
  if (order > 0) return first();
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) {
    throw new ReleasePlanError(
      `${name}: its level is ${level} but its current version "${text}" is ${currentLevel}; within a minor a level may go up, not down, because a version can only move forward`,
    );
  }
  if (level !== currentLevel) {
    const raised = first();
    if (compareVersions(parseVersion(raised), current) <= 0) {
      throw new ReleasePlanError(
        `${name}: moving up to ${level} gives "${raised}", which does not sort above its current version "${text}"`,
      );
    }
    return raised;
  }
  if (!input.bump.includes(name)) return text;
  return formatVersion(
    current.level === undefined
      ? { ...current, patch: current.patch + 1 }
      : { ...current, level: { ...current.level, counter: current.level.counter + 1 } },
  );
}

/**
 * The first version of a minor for a package at `level`: `X.Y.0` for GA and `X.Y.0-<level>.0` below
 * it, except at release `8.0`, where every package starts at patch 1, `8.0.1` or
 * `8.0.1-<level>.0`, so that none sorts below the release candidates `8.0.0-rc.N` published before
 * it. Every version a minor starts at and every range on one comes from here.
 */
export function firstVersionOfMinor(
  release: { readonly major: number; readonly minor: number },
  level: Level,
): string {
  const root = rootVersionOfRelease(release);
  return level === 'ga' ? root : `${root}-${level}.0`;
}

/** The root version of a release on the levels line: `8.0.1` for release `8.0`, `X.Y.0` for any other. */
export function rootVersionOfRelease(release: {
  readonly major: number;
  readonly minor: number;
}): string {
  const patch = release.major === 8 && release.minor === 0 ? 1 : 0;
  return `${release.major}.${release.minor}.${patch}`;
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const byNumber = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (byNumber !== 0) return byNumber;
  if (a.level === undefined || b.level === undefined) {
    return (a.level === undefined ? 1 : 0) - (b.level === undefined ? 1 : 0);
  }
  return LEVEL_ORDER[a.level.name] - LEVEL_ORDER[b.level.name] || a.level.counter - b.level.counter;
}

function levelRange(input: ReleasePlanInput, user: string, named: string): string {
  const level = input.numbering.get(named);
  if (level === undefined || hasOwnVersion(level)) {
    throw new ReleasePlanError(`${user} names ${named}, which has its own version`);
  }
  const kind = input.kinds[user];
  const widens =
    hasOwnVersion(input.numbering.get(user)) ||
    kind === 'extension' ||
    kind === 'library-integration';
  const operator = widens && level === 'ga' ? '^' : '~';
  return `${operator}${firstVersionOfMinor(input.release, level)}`;
}

function tagOf(input: ReleasePlanInput, name: string): string {
  if (input.dev !== undefined) return 'dev';
  const level = input.numbering.get(name);
  if (input.line === 'release-candidates' || level === 'ga' || hasOwnVersion(level)) {
    return 'latest';
  }
  return input.everGa.has(name) && level !== undefined ? level : 'latest';
}

function describeNumbering(numbering: Numbering): string {
  return hasOwnVersion(numbering) ? `its own version from ${numbering.firstVersion}` : numbering;
}

/** A declared own version, checked to be one this repository publishes. */
function parseVersionOf(name: string, text: string): string {
  try {
    parseVersion(text);
  } catch {
    throw new ReleasePlanError(
      `${name}: its own version "${text}" is not a version this repository publishes`,
    );
  }
  return text;
}

function withDev(version: string, dev: number | undefined): string {
  return dev === undefined ? version : `${version}-dev.${dev}`;
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export interface RootRelease {
  readonly release: { readonly major: number; readonly minor: number };
  readonly line: 'release-candidates' | 'levels';
  readonly rcCounter: number | undefined;
  readonly dev: number | undefined;
}

/**
 * The release a root version stands for. The root version is `8.0.0-rc.N` on the release-candidate
 * line and `rootVersionOfRelease` on the levels line, either followed by `-dev.N` for a development
 * build. Packages may carry other levels and patches; the root never does.
 */
export function releaseOfRootVersion(version: string): RootRelease {
  const parsed = parseVersion(version);
  const release = { major: parsed.major, minor: parsed.minor };
  if (parsed.patch === 0 && parsed.level?.name === 'rc') {
    if (parsed.major !== 8 || parsed.minor !== 0) {
      throw new ReleasePlanError(
        `root version "${version}" is a release candidate of ${parsed.major}.${parsed.minor}; only the 8.0.0 release candidates are planned, and a release-candidate line for another release is not built`,
      );
    }
    return {
      release,
      line: 'release-candidates',
      rcCounter: parsed.level.counter,
      dev: parsed.dev,
    };
  }
  if (parsed.level === undefined) {
    const root = rootVersionOfRelease(release);
    if (formatVersion({ ...parsed, dev: undefined }) === root) {
      return { release, line: 'levels', rcCounter: undefined, dev: parsed.dev };
    }
    if (parsed.major === 8 && parsed.minor === 0 && parsed.patch === 0) {
      throw new ReleasePlanError(
        `root version "${version}" is not a release: release 8.0 is cut as 8.0.1, because every package was published as 8.0.0-rc.N before it and no version of release 8.0 may sort below those`,
      );
    }
    throw new ReleasePlanError(
      `root version "${version}" is not the release number of ${release.major}.${release.minor}, which is ${root}`,
    );
  }
  throw new ReleasePlanError(
    `root version "${version}" is neither a release candidate 8.0.0-rc.N nor a release number such as 8.1.0`,
  );
}

export interface PublishedManifest {
  readonly name: string;
  readonly version: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

const OUR_SCOPE = '@prisma/orm-';

/**
 * The plan input for a root version, read from the published packages' manifests: each package's
 * current version, and the packages of ours it names as peers. A tree stamped for a development
 * build plans from the versions it was stamped from.
 */
export function planInputFor(options: {
  readonly rootVersion: string;
  readonly manifests: readonly PublishedManifest[];
  readonly numbering: ReadonlyMap<string, Numbering>;
  readonly kinds: Readonly<Record<string, PackageKind>>;
  readonly everGa: ReadonlySet<string>;
}): ReleasePlanInput {
  return {
    ...releaseOfRootVersion(options.rootVersion),
    current: Object.fromEntries(
      options.manifests.map((m) => [m.name, m.version.replace(/-dev\.\d+$/, '')]),
    ),
    uses: Object.fromEntries(
      options.manifests.map((m) => [
        m.name,
        Object.keys(m.peerDependencies ?? {}).filter((peer) => peer.startsWith(OUR_SCOPE)),
      ]),
    ),
    numbering: options.numbering,
    kinds: options.kinds,
    everGa: options.everGa,
    bump: [],
  };
}
