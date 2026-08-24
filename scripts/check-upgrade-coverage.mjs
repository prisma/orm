#!/usr/bin/env node
// Pre-publish + PR-CI gate for the upgrade-skill mechanism.
//
// Enforces two related invariants on every PR and every release.
// `package.json.version` on a given ref is the *currently published*
// version on that ref — the value `pnpm bump-version` reads when
// preparing the next release. The "in-flight" transition is therefore
// the step from head to the next release: `head.minor → head.minor + 1`
// for a stable version, or `rc.N → rc.N + 1` while head is on a
// release-candidate line. That is the directory where breaking-change
// entries authored on the current commit graph belong.
//
// A version's *transition segment* — the name it contributes to a
// directory — is `major.minor` when it is stable and the full
// `major.minor.patch-rc.N` when it is on an RC line, because an RC line
// lives inside a single minor and every RC may carry breaking changes.
// So `8.0.0-rc.1 → 8.0.0-rc.2` is the directory `8.0.0-rc.1-to-8.0.0-rc.2`,
// and the final RC to the stable release is `8.0.0-rc.7-to-8.0`.
//
//   1. Coverage. If the diff between prev and head touches `examples/`,
//      the user-skill package must carry an upgrade-instructions
//      directory for every step from prev to head.
//      Same for `packages/3-extensions/` and the extension-upgrade-skill
//      package. Two cases:
//        - PR mode (head.minor === prev.minor, no bump on the branch):
//          the diff is in-flight work; the required chain is the
//          single in-flight directory `upgrades/<head.minor>-to-<head.minor + 1>/`.
//        - Publish mode (head.minor > prev.minor, bump landed): the
//          diff describes everything shipping in this release; the
//          required chain is every consecutive directory from
//          `<prev.minor>-to-<prev.minor + 1>` through `<head.minor - 1>-to-<head.minor>`.
//          When a minor was bumped in-tree but never actually published,
//          the chain spans more than one step (e.g. 0.7-to-0.8 + 0.8-to-0.9
//          for a 0.7 → 0.9 publish); each directory must exist.
//        - RC line (either side is a `-rc.N` version): the required
//          chain is the single prev → head step. RC counters are not
//          chained arithmetically — one release is one step.
//
//   2. New-entries-go-in-the-chain-or-in-flight-directory. File
//      *adds* under either skill package's `upgrades/` tree must land
//      in either one of the coverage-chain directories (above) or the
//      in-flight directory keyed to head alone. Modifications and
//      removals are unrestricted, so old entries can be bug-fixed in
//      place.
//
// Usage:
//   node scripts/check-upgrade-coverage.mjs [--mode pr|publish]
//                                           [--head <ref>] [--prev <ref>]
//                                           [--json]
//
// Wired into root `package.json` as `pnpm check:upgrade-coverage`.
// Invoked from `.github/workflows/ci.yml` (mode pr) and
// `.github/workflows/publish.yml` (mode publish).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Parse the `changes:` key from an `instructions.md` frontmatter block.
 *
 * Accepts two shapes emitted by the upgrade-skill authoring workflow:
 *   - `changes: []`               — inline empty array (incidental diff no-op)
 *   - `changes:\n  - id: …\n …`  — block sequence (one or more real entries)
 *
 * Returns `{ ok: true, changes: Array<{id: string}> }` on success, or
 * `{ ok: false, reason: string }` when the frontmatter is absent or the
 * `changes:` key cannot be resolved.
 */
export function parseChangesFrontmatter(src) {
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(src);
  if (!fmMatch) {
    return { ok: false, reason: 'missing frontmatter block' };
  }
  const fm = fmMatch[1];

  // Inline empty array: `changes: []`
  if (/^changes:\s*\[\s*\]/m.test(fm)) {
    return { ok: true, changes: [] };
  }

  // Inline non-empty flow array: `changes: [foo]` or `changes: [a, b]`
  // Must have at least one non-whitespace character inside the brackets.
  if (/^changes:\s*\[.*\S.*\]/m.test(fm)) {
    const flowMatch = /^changes:\s*\[(.+)\]/m.exec(fm);
    const elements = flowMatch
      ? flowMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return { ok: true, changes: elements };
  }

  // Block sequence: `changes:` followed by indented `- ` bullet lines.
  // Walk lines linearly to avoid ReDoS from nested quantifiers on multi-line
  // patterns. Collect bullet lines after `changes:` until the first non-blank,
  // non-indented line.
  const lines = fm.split('\n');
  const changesIdx = lines.findIndex((l) => /^changes:\s*$/.test(l));
  if (changesIdx !== -1) {
    const bulletLines = [];
    for (let i = changesIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === '' || /^\s/.test(line)) {
        if (/^\s+-\s/.test(line)) bulletLines.push(line);
      } else {
        break;
      }
    }
    if (bulletLines.length > 0) {
      const entries = bulletLines.map((line) => {
        const idMatch = /^\s+-\s+id:\s+(.+)$/.exec(line);
        return idMatch ? { id: idMatch[1].trim() } : {};
      });
      return { ok: true, changes: entries };
    }
  }

  // `changes:` key present but with no recognisable value
  if (/^changes:/m.test(fm)) {
    return { ok: false, reason: 'changes key present but value is not an array' };
  }

  return { ok: false, reason: 'changes key absent' };
}

const USER_SKILL_PKG = 'skills/prisma-8/upgrading/app';
const EXT_SKILL_PKG = 'skills/prisma-8/upgrading/extension';

/**
 * Substrates covered by the gate. Each entry pairs a diff pathspec
 * (the file tree whose changes trigger the coverage check) with the
 * skill package that must host upgrade-instructions directories for
 * that substrate. The coverage-rule loop iterates this table — adding
 * a new substrate is a one-line change here, not a new hardcoded
 * block.
 */
const COVERAGE_SUBSTRATES = [
  { substrate: 'examples/', pathspec: 'examples/', skillPkg: USER_SKILL_PKG },
  {
    substrate: 'packages/3-extensions/',
    pathspec: 'packages/3-extensions/',
    skillPkg: EXT_SKILL_PKG,
  },
];

/**
 * Parse a `<major>.<minor>.<patch>[-<prerelease>]` version string into
 * `{ major, minor, patch, rc }` (all numbers, `rc` nullable). `rc` is the
 * release-candidate counter when the pre-release suffix is exactly
 * `rc.<n>` (`8.0.0-rc.3` → `3`) and `null` otherwise, including for any
 * other pre-release suffix such as `-dev.7`. Throws on malformed input.
 */
export function parseVersion(spec) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(spec);
  if (!match) {
    throw new Error(`unparseable version "${spec}"`);
  }
  const rcMatch = match[4] ? /^rc\.(\d+)$/.exec(match[4]) : null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: rcMatch ? Number(rcMatch[1]) : null,
  };
}

/**
 * The name a version contributes to a transition directory:
 * `<major>.<minor>` for a stable version, `<major>.<minor>.<patch>-rc.<n>`
 * for a release candidate. An RC line lives entirely inside one minor, so
 * keying an RC on its minor would collapse every RC of that line onto the
 * same directory.
 */
export function versionSegment(version) {
  return version.rc === null
    ? `${version.major}.${version.minor}`
    : `${version.major}.${version.minor}.${version.patch}-rc.${version.rc}`;
}

/**
 * Semver precedence for two parsed versions: negative when `left` is
 * older. The base version is compared before the RC counter, so
 * `8.0.1-rc.1` is correctly newer than `8.0.0-rc.9` — the counter resets
 * on each new base. A release candidate precedes its own release
 * (`8.0.0-rc.9` < `8.0.0`).
 */
export function comparePrecedence(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  if (left.rc === right.rc) return 0;
  if (left.rc === null) return 1;
  if (right.rc === null) return -1;
  return left.rc - right.rc;
}

/**
 * Returns the transition directory for the step from `prev` to `head`.
 * Used by the coverage sub-check in publish mode, where the "from" side
 * is the previously-published version and the "to" side is the version
 * being shipped.
 */
export function transitionLabel(prev, head) {
  return `${versionSegment(prev)}-to-${versionSegment(head)}`;
}

/**
 * The "in-flight" transition directory keyed to the head version alone —
 * the step from head to whatever ships next: the next minor for a stable
 * head, the next release candidate for an RC head. Authoring of new
 * upgrade-instructions entries on a feature branch goes here:
 * `package.json` on the head ref reads the currently-published version,
 * so the next batch of breaking-change work targets one release up.
 */
export function inFlightTransitionLabel(head) {
  const next = head.rc === null ? { ...head, minor: head.minor + 1 } : { ...head, rc: head.rc + 1 };
  return transitionLabel(head, next);
}

/**
 * The ordered chain of consecutive transition directories the coverage
 * sub-check expects to find for a (prev, head) pair.
 *
 * - RC line (either side carries an `rc` counter): single-element chain
 *   naming the prev → head step, because one RC release is one step and
 *   RC counters are not chained arithmetically. When prev and head are
 *   the same RC — PR-mode steady state during the RC line — the element
 *   is the in-flight directory instead.
 * - PR-mode steady-state (prev.minor === head.minor): single-element
 *   chain naming the in-flight directory; the substrate diff is in-flight
 *   work.
 * - Publish mode (head.minor > prev.minor, same major): one element per
 *   consecutive minor step from prev.minor to head.minor. When a minor
 *   was bumped in-tree but never actually published, the chain has
 *   more than one element (e.g. 0.7-to-0.8 + 0.8-to-0.9 for a 0.7 → 0.9
 *   publish); every directory in the chain must exist.
 * - Major boundary (prev.major !== head.major): the minor counter
 *   resets, so a literal minor-chain doesn't compose. Falls back to
 *   the single-step prev → head label; chain semantics across a major
 *   bump are deliberately out of scope.
 */
export function coverageTransitionChain(head, prev) {
  if (head.rc !== null || prev.rc !== null) {
    if (comparePrecedence(head, prev) < 0) {
      throw new Error(
        `check-upgrade-coverage: head ${versionSegment(head)} is behind prev ${versionSegment(prev)} (reversed RC range); rebase or pass refs in chronological order`,
      );
    }
    return versionSegment(head) === versionSegment(prev)
      ? [inFlightTransitionLabel(head)]
      : [transitionLabel(prev, head)];
  }
  if (head.major !== prev.major) {
    return [transitionLabel(prev, head)];
  }
  if (head.minor < prev.minor) {
    throw new Error(
      `check-upgrade-coverage: head ${head.major}.${head.minor} is behind prev ${prev.major}.${prev.minor} (reversed same-major range); rebase or pass refs in chronological order`,
    );
  }
  if (head.minor === prev.minor) {
    return [inFlightTransitionLabel(head)];
  }
  const labels = [];
  for (let m = prev.minor; m < head.minor; m++) {
    labels.push(`${head.major}.${m}-to-${head.major}.${m + 1}`);
  }
  return labels;
}

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRANSITION_PATH = new RegExp(
  `^(?:${[USER_SKILL_PKG, EXT_SKILL_PKG].map(escapeForRegExp).join('|')})/upgrades/([^/]+)/`,
);

/**
 * Parse a path under `<skill-pkg>/upgrades/<transition>/...` and return
 * the transition segment, or null if the path does not match.
 *
 * Example: `skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/foo.ts`
 *  → `'0.7-to-0.8'`
 */
export function parseTransitionFromPath(path) {
  const match = TRANSITION_PATH.exec(path);
  return match ? match[1] : null;
}

function git(repoRoot, ...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(repoRoot, ...args) {
  try {
    return git(repoRoot, ...args).trim();
  } catch {
    return null;
  }
}

function readPackageJsonAtRef(repoRoot, ref) {
  const raw = git(repoRoot, 'show', `${ref}:package.json`);
  return JSON.parse(raw);
}

function tryReadFileAtRef(repoRoot, ref, path) {
  try {
    return git(repoRoot, 'show', `${ref}:${path}`);
  } catch {
    return null;
  }
}

function diffAllChangedPaths(repoRoot, prev, head) {
  const out = git(repoRoot, 'diff', '--name-only', `${prev}..${head}`);
  return new Set(out.split('\n').filter(Boolean));
}

const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

const BIOME_CONFIG_NAMES = new Set(['biome.json', 'biome.jsonc']);
const TEST_INFRASTRUCTURE_CONFIG_NAMES = new Set(['coverage.config.json']);

function isTestInfrastructurePath(path) {
  const name = basename(path);
  return (
    TEST_INFRASTRUCTURE_CONFIG_NAMES.has(name) ||
    /^vitest\.config\.[cm]?[jt]s$/.test(name) ||
    /(^|\/)tests?(\/|$)/.test(path) ||
    /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(name)
  );
}

/** Key-sorted JSON, so a reordered manifest compares equal to itself. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The manifest with every dependency *version* blanked; names are kept.
 *  With `ignoreOwnVersion`, the package's own `version` field is blanked
 *  too — the shape a release sweep produces. */
function normalizeManifest(text, ignoreOwnVersion, ignoreScripts) {
  const parsed = JSON.parse(text);
  if (ignoreOwnVersion && typeof parsed.version === 'string') parsed.version = '';
  for (const map of DEPENDENCY_MAPS) {
    const deps = parsed[map];
    if (deps !== null && typeof deps === 'object' && !Array.isArray(deps)) {
      parsed[map] = Object.fromEntries(Object.keys(deps).map((name) => [name, '']));
    }
  }
  if (ignoreScripts) {
    delete parsed.scripts;
  }
  return canonicalJson(parsed);
}

export function manifestShapeIgnoringVersions(text, ignoreOwnVersion = false) {
  return normalizeManifest(text, ignoreOwnVersion, false);
}

/**
 * Whether a changed file can carry no downstream translation.
 *
 * Test files and test-runner configuration are not consumer inputs. Dependency
 * version moves, package-local script changes, and lint schema URL updates
 * likewise require no downstream code translation. Adding or removing a
 * dependency still qualifies because a package name can signal an API change.
 */
function isTranslationIrrelevant(repoRoot, prev, head, path, ignoreOwnVersion = false) {
  if (isTestInfrastructurePath(path)) return true;

  const before = tryReadFileAtRef(repoRoot, prev, path);
  const after = tryReadFileAtRef(repoRoot, head, path);
  // An added or deleted file is a structural change, not a version move.
  if (before === null || after === null) return false;

  if (basename(path) === 'package.json') {
    try {
      return (
        normalizeManifest(before, ignoreOwnVersion, true) ===
        normalizeManifest(after, ignoreOwnVersion, true)
      );
    } catch {
      return false;
    }
  }
  if (BIOME_CONFIG_NAMES.has(basename(path))) {
    const blankSchema = (text) => text.replace(/"\$schema"\s*:\s*"[^"]*"/g, '"$schema":""');
    return blankSchema(before) === blankSchema(after);
  }
  return false;
}

function diffPaths(repoRoot, prev, head, pathspecs) {
  const args = ['diff', '--name-only', `${prev}..${head}`, '--'];
  args.push(...pathspecs);
  const out = git(repoRoot, ...args);
  return out.split('\n').filter(Boolean);
}

function diffAddedPaths(repoRoot, prev, head, pathspecs) {
  const addArgs = ['diff', '--name-only', '--diff-filter=A', `${prev}..${head}`, '--'];
  addArgs.push(...pathspecs);
  const added = git(repoRoot, ...addArgs)
    .split('\n')
    .filter(Boolean);

  if (added.length === 0) return added;

  // Rename detection requires seeing both ends of the rename pair, so we must
  // query the full diff (no pathspec) with -M. Files that appear as rename
  // destinations (R) in the repo-wide diff are moves, not genuine additions,
  // and should be excluded.
  const renameOut = git(
    repoRoot,
    'diff',
    '-M',
    '--name-status',
    '--diff-filter=R',
    `${prev}..${head}`,
  );
  const renameDestinations = new Set(
    renameOut
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        // Each line is "R<score>\t<old-path>\t<new-path>"
        const parts = line.split('\t');
        return parts[2];
      })
      .filter(Boolean),
  );

  return added.filter((p) => !renameDestinations.has(p));
}

function resolveDefaultPrev(repoRoot, mode) {
  if (mode === 'pr') {
    // Prefer `origin/main`; fall back to local `main` (some CI checkouts
    // don't preserve the `origin` remote name).
    const refs = ['origin/main', 'main'];
    for (const ref of refs) {
      if (tryGit(repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`)) {
        return ref;
      }
    }
    throw new Error(
      'check-upgrade-coverage: --mode pr default --prev requires either `origin/main` or `main` to exist; pass --prev <ref> explicitly',
    );
  }
  // mode publish — fall back to the most recent release `v[0-9]*` tag:
  // stable or `v*-rc.N`, excluding build tags (`v*-dev.N`, `v*-beta.N`).
  // The publish-time check compares the full release cycle against the
  // last shipped version — on the RC line that is the previous RC. A dev
  // tag sits on an intermediate commit (often the bump commit's parent),
  // which would shrink the diff to the bump itself and trip
  // per-pr-declaration on every package.json the bump rewrites.
  const tag = tryGit(
    repoRoot,
    'describe',
    '--abbrev=0',
    '--tags',
    '--match',
    'v[0-9]*',
    '--exclude',
    '*-dev.*',
    '--exclude',
    '*-beta.*',
  );
  if (tag) return tag;
  throw new Error(
    'check-upgrade-coverage: --mode publish default --prev requires a release `v[0-9]*` git tag (dev/beta build tags are excluded); pass --prev <ref> explicitly',
  );
}

/**
 * Parse the supported CLI arguments. Exported for unit tests.
 */
export function parseArgs(args) {
  const out = { mode: 'pr', head: 'HEAD', prev: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode') {
      out.mode = args[++i];
    } else if (arg === '--head') {
      out.head = args[++i];
    } else if (arg === '--prev') {
      out.prev = args[++i];
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      throw new Error(`check-upgrade-coverage: unknown argument "${arg}"`);
    }
  }
  if (out.mode !== 'pr' && out.mode !== 'publish') {
    throw new Error(`check-upgrade-coverage: --mode must be "pr" or "publish" (got "${out.mode}")`);
  }
  return out;
}

/**
 * Run the check. Returns `{ ok, violations }`; the caller is
 * responsible for deciding how to render the result (text vs JSON)
 * and for `process.exit`.
 */
export function runCheck({ repoRoot, head, prev }) {
  const headVersion = parseVersion(readPackageJsonAtRef(repoRoot, head).version);
  const prevVersion = parseVersion(readPackageJsonAtRef(repoRoot, prev).version);

  const headSegment = versionSegment(headVersion);
  const prevSegment = versionSegment(prevVersion);
  const coverageChain = coverageTransitionChain(headVersion, prevVersion);
  const inflightTransition = inFlightTransitionLabel(headVersion);

  const violations = [];

  // Compute the full set of changed paths once; reused by the
  // per-PR-declaration check below.
  const changedPaths = diffAllChangedPaths(repoRoot, prev, head);

  // Coverage check fires whenever the substrate diff is non-empty.
  // No carve-out for patch ranges, no carve-out for "regenerated"
  // artefacts. A consumer-facing diff is a consumer-facing diff —
  // record it. When the diff legitimately needs no consumer-side
  // action (e.g. internal-only change with incidental example
  // regeneration), the entry's `changes: []` placeholder shape says
  // exactly that and is cheap to ship.
  //
  // The chain spans every consecutive minor step from prev to head; a
  // skip-publish (a minor bumped in-tree but never actually shipped)
  // produces a multi-element chain and each directory must exist.
  // One violation per missing directory keeps the diagnostic surface
  // line-oriented and tells the author exactly which directories the
  // gate wants.
  for (const { substrate, pathspec, skillPkg } of COVERAGE_SUBSTRATES) {
    // A diff that only moves dependency versions or a `$schema` URL has
    // nothing for a consumer to translate, so it does not put the substrate
    // in scope at all.
    const substrateDiff = diffPaths(repoRoot, prev, head, [pathspec]).filter(
      (path) => !isTranslationIrrelevant(repoRoot, prev, head, path),
    );
    if (substrateDiff.length === 0) continue;
    // A release sweep — every remaining substrate file differs only in
    // version fields — keeps the coverage rule in force (the transition
    // directory must exist), but demands no fresh per-PR declaration:
    // the sweep declares nothing an earlier PR has not already recorded.
    const sweepOnly = substrateDiff.every((path) =>
      isTranslationIrrelevant(repoRoot, prev, head, path, true),
    );
    for (const transition of coverageChain) {
      const requiredDir = `${skillPkg}/upgrades/${transition}`;
      if (!existsSync(`${repoRoot}/${requiredDir}`)) {
        violations.push({
          rule: 'coverage',
          substrate,
          requiredDir,
          sampleDiffPaths: substrateDiff.slice(0, 5),
        });
        continue;
      }
      // Per-PR correspondence check: the directory exists, but this PR
      // must also have touched the instructions.md and that file must
      // carry a valid `changes:` array (empty or non-empty) so that
      // deliberate intent is recorded per PR, not just per transition
      // directory creation.
      const instructionsPath = `${skillPkg}/upgrades/${transition}/instructions.md`;
      if (sweepOnly && !changedPaths.has(instructionsPath)) continue;
      if (!changedPaths.has(instructionsPath)) {
        violations.push({
          rule: 'per-pr-declaration',
          substrate,
          instructionsPath,
          sampleDiffPaths: substrateDiff.slice(0, 5),
        });
        continue;
      }
      const raw = tryReadFileAtRef(repoRoot, head, instructionsPath);
      const parsed = raw ? parseChangesFrontmatter(raw) : { ok: false, reason: 'file unreadable' };
      if (!parsed.ok) {
        violations.push({
          rule: 'per-pr-declaration',
          substrate,
          instructionsPath,
          malformed: true,
          reason: parsed.reason,
          sampleDiffPaths: substrateDiff.slice(0, 5),
        });
      }
    }
  }

  // New-entries rule: an added file may live in any directory in the
  // coverage chain (the release this commit graph is preparing for, or
  // each step of a skip-publish release) or the in-flight directory
  // (the next release after head). Anything in an older transition
  // directory is stale.
  const allowedTransitions = new Set([...coverageChain, inflightTransition]);
  const adds = diffAddedPaths(repoRoot, prev, head, [
    `${USER_SKILL_PKG}/upgrades/`,
    `${EXT_SKILL_PKG}/upgrades/`,
  ]);
  for (const path of adds) {
    const transitionInPath = parseTransitionFromPath(path);
    if (transitionInPath === null) continue; // not under a transition dir
    if (!allowedTransitions.has(transitionInPath)) {
      violations.push({
        rule: 'new-entries-stale-transition',
        path,
        observedTransition: transitionInPath,
        allowedTransitions: [...allowedTransitions],
      });
    }
  }

  return {
    ok: violations.length === 0,
    headSegment,
    prevSegment,
    coverageChain,
    inflightTransition,
    violations,
  };
}

function renderViolations(result, write) {
  write(
    `check-upgrade-coverage: ${result.violations.length} violation(s) (${result.prevSegment} → ${result.headSegment})\n`,
  );
  for (const v of result.violations) {
    if (v.rule === 'coverage') {
      write(
        `  [coverage] diff in ${v.substrate} requires an upgrade-instructions directory at\n` +
          `              ${v.requiredDir}/instructions.md\n`,
      );
      if (v.sampleDiffPaths.length > 0) {
        write('              sample paths from the diff:\n');
        for (const p of v.sampleDiffPaths) {
          write(`                ${p}\n`);
        }
      }
    } else if (v.rule === 'new-entries-stale-transition') {
      write(
        `  [new-entries-stale-transition] added ${v.path}\n` +
          `              transition is "${v.observedTransition}" but only the following are accepted:\n` +
          `                ${v.allowedTransitions.join(', ')}\n` +
          '              move the new file under one of:\n' +
          `                ${USER_SKILL_PKG}/upgrades/<one-of-the-above>/instructions.md\n` +
          `                ${EXT_SKILL_PKG}/upgrades/<one-of-the-above>/instructions.md\n`,
      );
    } else if (v.rule === 'per-pr-declaration') {
      if (v.malformed) {
        write(
          `  [per-pr-declaration] ${v.instructionsPath} was updated but its frontmatter\n` +
            `              is missing or has a malformed changes: key (${v.reason});\n` +
            '              add a changes[] entry or declare `changes: []` for an incidental diff\n',
        );
      } else {
        write(
          `  [per-pr-declaration] PR touches ${v.substrate} but did not record an upgrade\n` +
            `              declaration in ${v.instructionsPath};\n` +
            '              add a changes[] entry or declare `changes: []` for an incidental diff\n',
        );
      }
      if (v.sampleDiffPaths.length > 0) {
        write('              sample paths from the diff:\n');
        for (const p of v.sampleDiffPaths) {
          write(`                ${p}\n`);
        }
      }
    }
  }
  write(
    '\nSee the in-repo `record-upgrade-instructions` skill for the authoring workflow:\n' +
      '  .agents/skills/record-upgrade-instructions/SKILL.md\n',
  );
}

export function main(args = argv.slice(2), repoRoot = cwd()) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  if (parsed.help) {
    stdout.write(
      [
        'Usage: node scripts/check-upgrade-coverage.mjs [--mode pr|publish] [--head <ref>] [--prev <ref>] [--json]',
        '',
        '  --mode    pr (default) or publish; selects the default --prev source',
        '  --head    git ref to inspect (default: HEAD)',
        '  --prev    git ref to compare against (default: origin/main for pr; most',
        '            recent release v[0-9]* tag for publish — stable or -rc.N,',
        '            dev/beta build tags excluded)',
        '  --json    emit a JSON result envelope on stdout instead of text on stderr',
        '',
      ].join('\n'),
    );
    return 0;
  }
  const head = parsed.head;
  let prev = parsed.prev;
  try {
    if (prev === null) {
      prev = resolveDefaultPrev(repoRoot, parsed.mode);
    }
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }
  let result;
  try {
    result = runCheck({ repoRoot, head, prev });
  } catch (err) {
    stderr.write(`check-upgrade-coverage: ${err.message}\n`);
    return 2;
  }
  if (parsed.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (result.ok) {
    return 0;
  }
  renderViolations(result, (s) => stderr.write(s));
  return 1;
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  exit(main());
}
