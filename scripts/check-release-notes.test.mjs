import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { notesFileForVersion, parseArgs } from './check-release-notes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, 'check-release-notes.mjs');

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writePackageJson(version) {
  writeRepoFile('package.json', JSON.stringify({ name: 'fixture', version }, null, 2));
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-m', message);
}

function runScript(args) {
  return spawnSync(execPath, [SCRIPT_PATH, ...args], { cwd: repo, encoding: 'utf8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-release-notes-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('notesFileForVersion', () => {
  it('maps a version to its committed notes path', () => {
    assert.equal(notesFileForVersion('0.12.0'), 'docs/releases/v0.12.0.md');
    assert.equal(notesFileForVersion('1.0.0'), 'docs/releases/v1.0.0.md');
  });
});

describe('parseArgs', () => {
  it('defaults to pr mode, HEAD, no prev/version, text output', () => {
    assert.deepEqual(parseArgs([]), {
      mode: 'pr',
      head: 'HEAD',
      prev: null,
      version: null,
      json: false,
    });
  });
  it('parses every supported flag', () => {
    const out = parseArgs([
      '--mode',
      'publish',
      '--head',
      'abc',
      '--prev',
      'def',
      '--version',
      '0.12.0',
      '--json',
    ]);
    assert.equal(out.mode, 'publish');
    assert.equal(out.head, 'abc');
    assert.equal(out.prev, 'def');
    assert.equal(out.version, '0.12.0');
    assert.equal(out.json, true);
  });
  it('rejects an unknown mode', () => {
    assert.throws(() => parseArgs(['--mode', 'nope']), /--mode must be/);
  });
  it('rejects an unknown argument', () => {
    assert.throws(() => parseArgs(['--frobnicate']), /unknown argument/);
  });
});

describe('check-release-notes — publish mode', () => {
  it('exits non-zero when the notes file for the head version is absent', () => {
    writePackageJson('0.12.0');
    commitAll('release bump, no notes');
    const result = runScript(['--mode', 'publish', '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/releases\/v0\.12\.0\.md/);
    assert.match(result.stderr, /no\s+auto-generated fallback/);
  });

  it('exits 0 when the notes file for the head version is present', () => {
    writePackageJson('0.12.0');
    writeRepoFile('docs/releases/v0.12.0.md', '# v0.12.0\n');
    commitAll('release bump with notes');
    const result = runScript(['--mode', 'publish', '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('stops, naming it, on a version this repository does not publish', () => {
    writePackageJson('0.12.0');
    commitAll('release bump');
    const result = runScript(['--mode', 'publish', '--version', '8.0.0-beta.1']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /8\.0\.0-beta\.1/);
  });

  it('honours --version over the package.json version', () => {
    writePackageJson('0.12.0');
    writeRepoFile('docs/releases/v0.99.0.md', '# v0.99.0\n');
    commitAll('notes for an explicit version');
    // package.json says 0.12.0 (no notes) but --version targets 0.99.0 (has notes).
    const result = runScript(['--mode', 'publish', '--version', '0.99.0']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    const missing = runScript(['--mode', 'publish', '--version', '0.12.0']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /docs\/releases\/v0\.12\.0\.md/);
  });
});

describe('check-release-notes — pr mode', () => {
  it('no-ops (exit 0) when the root version is unchanged between prev and head', () => {
    writePackageJson('0.11.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('docs/some-unrelated-change.md', 'edit\n');
    commitAll('head, no version bump');
    const result = runScript(['--mode', 'pr', '--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('exits non-zero when the version changed but the matching notes file is absent', () => {
    writePackageJson('0.11.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.12.0');
    commitAll('head: release bump, no notes file');
    const result = runScript(['--mode', 'pr', '--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/releases\/v0\.12\.0\.md/);
  });

  it('exits 0 when the version changed and the matching notes file is present', () => {
    writePackageJson('0.11.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.12.0');
    writeRepoFile('docs/releases/v0.12.0.md', '# v0.12.0\n');
    commitAll('head: release bump with notes');
    const result = runScript(['--mode', 'pr', '--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('--json envelope reports ok=false and the missing notes file', () => {
    writePackageJson('0.11.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.12.0');
    commitAll('head: release bump, no notes file');
    const result = runScript(['--mode', 'pr', '--prev', prev, '--head', 'HEAD', '--json']);
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.bumped, true);
    assert.equal(parsed.version, '0.12.0');
    assert.deepEqual(
      parsed.violations.map((v) => v.notesFile),
      ['docs/releases/v0.12.0.md'],
    );
  });
});
