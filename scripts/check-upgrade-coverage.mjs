#!/usr/bin/env node
// PR declarations are unversioned; releases require assembled guides and no pending files.
import { execFileSync } from 'node:child_process';
import { basename, posix } from 'node:path';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

export function parseChangesFrontmatter(src) {
  if (!/^---\s*\n[\s\S]*?\n---/.test(src))
    return { ok: false, reason: 'missing frontmatter block' };
  try {
    const { data } = matter(src);
    if (Array.isArray(data?.changes)) return { ok: true, changes: data.changes };
    return { ok: false, reason: 'changes key must contain an array' };
  } catch {
    return { ok: false, reason: 'malformed YAML frontmatter' };
  }
}

export function parseVersion(spec) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(spec);
  if (!match) throw new Error(`unparseable version "${spec}"`);
  const rc = match[4] ? /^rc\.(\d+)$/.exec(match[4]) : null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: rc ? Number(rc[1]) : null,
  };
}
export function versionSegment(version) {
  return version.rc === null
    ? `${version.major}.${version.minor}`
    : `${version.major}.${version.minor}.${version.patch}-rc.${version.rc}`;
}
export function comparePrecedence(left, right) {
  for (const field of ['major', 'minor', 'patch'])
    if (left[field] !== right[field]) return left[field] - right[field];
  if (left.rc === right.rc) return 0;
  if (left.rc === null) return 1;
  if (right.rc === null) return -1;
  return left.rc - right.rc;
}
export function transitionLabel(prev, head) {
  return `${versionSegment(prev)}-to-${versionSegment(head)}`;
}

const PENDING = 'upgrade-instructions/pending/';
const PENDING_INSTRUCTIONS =
  /^upgrade-instructions\/pending\/[^/]+\/(app|extension)\/instructions\.md$/;
const PUBLISHED_DIRECTORY = /^(skills\/prisma-8\/upgrading\/(?:app|extension)\/upgrades\/[^/]+)\//;
const COVERED_DIRECTORIES = [
  { audience: 'app', directory: 'examples/' },
  { audience: 'extension', directory: 'packages/3-extensions/' },
];
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
function readFile(repoRoot, ref, path) {
  try {
    return git(repoRoot, 'show', `${ref}:${path}`);
  } catch {
    return null;
  }
}
function tree(repoRoot, ref) {
  return new Map(
    git(repoRoot, 'ls-tree', '-r', '-z', ref)
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf('\t');
        return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[0]];
      }),
  );
}
function changedPaths(repoRoot, prev, head) {
  return git(repoRoot, 'diff', '--no-renames', '--name-only', '-z', prev, head, '--')
    .split('\0')
    .filter(Boolean);
}

const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const BIOME_CONFIG_NAMES = new Set(['biome.json', 'biome.jsonc']);
const CONTRACT_ARTEFACT_NAMES = new Set(['contract.json', 'contract.d.ts']);
function isTestInfrastructurePath(path) {
  const name = basename(path);
  return (
    name === 'coverage.config.json' ||
    /^vitest\.config\.[cm]?[jt]s$/.test(name) ||
    /(^|\/)tests?(\/|$)/.test(path) ||
    /\.(test|spec)(-d)?\.[cm]?[jt]sx?$/.test(name)
  );
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function normalizeManifest(text, ignoreOwnVersion, ignoreScripts) {
  const parsed = JSON.parse(text);
  if (ignoreOwnVersion && typeof parsed.version === 'string') parsed.version = '';
  for (const map of DEPENDENCY_MAPS) {
    const deps = parsed[map];
    if (deps !== null && typeof deps === 'object' && !Array.isArray(deps))
      parsed[map] = Object.fromEntries(Object.keys(deps).map((name) => [name, '']));
  }
  if (ignoreScripts) delete parsed.scripts;
  return canonicalJson(parsed);
}
export function manifestShapeIgnoringVersions(text, ignoreOwnVersion = false) {
  return normalizeManifest(text, ignoreOwnVersion, false);
}
export function blankExtensionVersionStamps(text) {
  return text
    .replace(/("targetId":\s*"[^"]*",\s*"version":\s*")[^"]*(")/g, '$1$2')
    .replace(/(readonly targetId:\s*'[^']*';\s*readonly version:\s*')[^']*(')/g, '$1$2');
}
function isTranslationIrrelevant(repoRoot, prev, head, path) {
  if (isTestInfrastructurePath(path)) return true;
  const before = readFile(repoRoot, prev, path);
  const after = readFile(repoRoot, head, path);
  if (before === null || after === null) return false;
  if (basename(path) === 'package.json') {
    try {
      return normalizeManifest(before, false, true) === normalizeManifest(after, false, true);
    } catch {
      return false;
    }
  }
  if (BIOME_CONFIG_NAMES.has(basename(path))) {
    const blankSchema = (text) => text.replace(/"\$schema"\s*:\s*"[^"]*"/g, '"$schema":""');
    return blankSchema(before) === blankSchema(after);
  }
  if (CONTRACT_ARTEFACT_NAMES.has(basename(path)))
    return blankExtensionVersionStamps(before) === blankExtensionVersionStamps(after);
  return false;
}

function validateInstructions(repoRoot, head, files, path, violations) {
  const raw = readFile(repoRoot, head, path);
  const regular = /^100(?:644|755)$/.test(files.get(path) ?? '');
  const parsed =
    regular && raw !== null
      ? parseChangesFrontmatter(raw)
      : { ok: false, reason: 'instructions file missing or not a regular file' };
  if (!parsed.ok) {
    violations.push({ rule: 'instructions-format', path, reason: parsed.reason });
    return;
  }
  for (const change of parsed.changes) {
    if (change === null || typeof change !== 'object' || !Object.hasOwn(change, 'script')) continue;
    const script = change.script;
    const invalid =
      typeof script !== 'string' ||
      !script ||
      script.includes('\\') ||
      script.startsWith('/') ||
      /^[a-z][a-z0-9+.-]*:/i.test(script) ||
      script.split('/').includes('..');
    const target = invalid ? null : posix.join(posix.dirname(path), script);
    if (invalid || !/^100(?:644|755)$/.test(files.get(target) ?? ''))
      violations.push({
        rule: 'script-reference',
        path,
        script: String(script),
        reason: 'script must reference an existing regular file within this instruction directory',
      });
  }
}

function resolveDefaultPrev(repoRoot, mode, head) {
  if (mode === 'dev') return head;
  if (mode === 'pr') {
    for (const ref of ['origin/main', 'main'])
      if (tryGit(repoRoot, 'rev-parse', '--verify', `${ref}^{commit}`)) return ref;
    throw new Error(
      '--mode pr default --prev requires origin/main or main; pass --prev <ref> explicitly',
    );
  }
  const tag = previousReleaseTag(repoRoot, head);
  if (tag) return tag;
  throw new Error(
    '--mode publish default --prev requires a prior release tag reachable from --head (dev/beta and the head release excluded); pass --prev <ref> explicitly',
  );
}
function previousReleaseTag(repoRoot, head) {
  const headVersion = parseVersion(
    JSON.parse(git(repoRoot, 'show', `${head}:package.json`)).version,
  );
  const tags = git(repoRoot, 'tag', '--merged', head, '--list', 'v[0-9]*')
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(tag));
  const prior = tags.filter(
    (tag) => comparePrecedence(parseVersion(tag.slice(1)), headVersion) < 0,
  );
  if (prior.length) {
    const args = prior.flatMap((tag) => ['--match', tag]);
    const tag = tryGit(repoRoot, 'describe', '--abbrev=0', '--tags', ...args, head);
    if (tag) return tag;
  }
  return null;
}
export function parseArgs(args) {
  const out = { mode: 'pr', head: 'HEAD', prev: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--mode', '--head', '--prev'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      out[arg.slice(2)] = value;
    } else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument "${arg}"`);
  }
  if (!['pr', 'publish', 'dev'].includes(out.mode))
    throw new Error('--mode must be "pr", "publish" or "dev"');
  return out;
}
export function runCheck({ repoRoot, head = 'HEAD', prev, mode = 'pr' }) {
  if (!['pr', 'publish', 'dev'].includes(mode)) throw new Error(`invalid mode "${mode}"`);
  head = git(repoRoot, 'rev-parse', '--verify', `${head}^{commit}`).trim();
  prev = prev ?? resolveDefaultPrev(repoRoot, mode, head);
  prev = git(repoRoot, 'rev-parse', '--verify', `${prev}^{commit}`).trim();
  const headVersion = parseVersion(
    JSON.parse(git(repoRoot, 'show', `${head}:package.json`)).version,
  );
  const prevVersion = parseVersion(
    JSON.parse(git(repoRoot, 'show', `${prev}:package.json`)).version,
  );
  const precedence = comparePrecedence(headVersion, prevVersion);
  if (precedence < 0)
    throw new Error(
      `head ${versionSegment(headVersion)} is behind prev ${versionSegment(prevVersion)} (reversed range)`,
    );
  const release = mode === 'publish' || (mode === 'pr' && precedence > 0);
  const files = tree(repoRoot, head);
  const baseFiles = tree(repoRoot, prev);
  const changed = changedPaths(repoRoot, prev, head);
  const pending = [...files.keys()].filter((path) => path.startsWith(PENDING));
  const declarations = pending.filter((path) => PENDING_INSTRUCTIONS.test(path));
  const validate = new Set([
    ...declarations,
    ...changed.flatMap((path) => {
      const directory = PUBLISHED_DIRECTORY.exec(path)?.[1];
      const guide = directory ? `${directory}/instructions.md` : null;
      return guide && files.has(guide) ? [guide] : [];
    }),
  ]);
  const violations = [];
  const releaseBase = release && mode === 'pr' ? previousReleaseTag(repoRoot, head) : null;
  const releaseFrom = releaseBase
    ? parseVersion(JSON.parse(git(repoRoot, 'show', `${releaseBase}:package.json`)).version)
    : prevVersion;
  const transition = release ? transitionLabel(releaseFrom, headVersion) : null;
  if (release) {
    for (const path of pending)
      violations.push({
        rule: 'pending-release',
        path,
        reason: 'assemble and archive all pending files before release',
      });
    for (const { audience } of COVERED_DIRECTORIES)
      validate.add(`skills/prisma-8/upgrading/${audience}/upgrades/${transition}/instructions.md`);
  } else if (mode === 'pr') {
    for (const { audience, directory } of COVERED_DIRECTORIES) {
      const relevant = changed.filter(
        (path) =>
          path.startsWith(directory) && !isTranslationIrrelevant(repoRoot, prev, head, path),
      );
      if (
        relevant.length &&
        !declarations.some(
          (path) => PENDING_INSTRUCTIONS.exec(path)[1] === audience && !baseFiles.has(path),
        )
      ) {
        violations.push({
          rule: 'per-pr-declaration',
          path: `${PENDING}<name>/${audience}/instructions.md`,
          reason: `diff in ${directory} requires a new declaration relative to --prev; inherited or modified files do not count`,
          sampleDiffPaths: relevant.slice(0, 5),
        });
      }
    }
  }
  for (const path of validate) validateInstructions(repoRoot, head, files, path, violations);
  return {
    ok: violations.length === 0,
    mode,
    release,
    headSegment: versionSegment(headVersion),
    prevSegment: versionSegment(prevVersion),
    coverageChain: transition ? [transition] : [],
    violations,
  };
}
export function main(args = argv.slice(2), repoRoot = cwd()) {
  try {
    const parsed = parseArgs(args);
    if (parsed.help) {
      stdout.write(
        'Usage: check-upgrade-coverage [--mode pr|publish|dev] [--head <ref>] [--prev <ref>] [--json]\nPR checks new pending declarations, or release completeness on a version bump.\nPublish always checks release completeness; dev validates pending work without blocking publication.\nDefault prev: origin/main or main (pr), prior release tag reachable from head (publish), head (dev).\n',
      );
      return 0;
    }
    const result = runCheck({ repoRoot, ...parsed });
    if (parsed.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (!result.ok) {
      stderr.write(
        `check-upgrade-coverage: ${result.violations.length} violation(s) (${result.prevSegment} → ${result.headSegment})\n`,
      );
      for (const v of result.violations)
        stderr.write(
          `  [${v.rule}] ${v.path}: ${v.reason}${v.script ? ` (${v.script})` : ''}\n${(v.sampleDiffPaths ?? []).map((p) => `    ${p}\n`).join('')}`,
        );
      stderr.write(
        'See skills-contrib/record-upgrade-instructions/SKILL.md for authoring and skills-contrib/publish-npm-version/SKILL.md for assembly.\n',
      );
    }
    return result.ok ? 0 : 1;
  } catch (err) {
    stderr.write(`check-upgrade-coverage: ${err.message}\n`);
    return 2;
  }
}
if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) exit(main());
