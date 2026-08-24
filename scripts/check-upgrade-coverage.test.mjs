import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  comparePrecedence,
  coverageTransitionChain,
  inFlightTransitionLabel,
  manifestShapeIgnoringVersions,
  parseChangesFrontmatter,
  parseTransitionFromPath,
  parseVersion,
  transitionLabel,
} from './check-upgrade-coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, 'check-upgrade-coverage.mjs');

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
  repo = mkdtempSync(join(tmpdir(), 'pn-upgrade-coverage-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('parseTransitionFromPath', () => {
  it('extracts the transition segment for the user skill', () => {
    assert.equal(
      parseTransitionFromPath('skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/foo.ts'),
      '0.7-to-0.8',
    );
  });
  it('extracts the transition segment for the extension skill', () => {
    assert.equal(
      parseTransitionFromPath(
        'skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md',
      ),
      '0.7-to-0.8',
    );
  });
  it('returns null for paths outside an upgrades/<transition>/ subdirectory', () => {
    assert.equal(parseTransitionFromPath('skills/prisma-8/upgrading/app/SKILL.md'), null);
    assert.equal(parseTransitionFromPath('skills/prisma-8/upgrading/app/upgrades/'), null);
    assert.equal(parseTransitionFromPath('examples/foo/bar.ts'), null);
  });
});

describe('parseVersion', () => {
  it('reports the release-candidate counter for an rc.N pre-release', () => {
    assert.deepEqual(parseVersion('8.0.0-rc.3'), { major: 8, minor: 0, patch: 0, rc: 3 });
  });
  it('reports rc: null for a stable version', () => {
    assert.deepEqual(parseVersion('0.17.0'), { major: 0, minor: 17, patch: 0, rc: null });
  });
  it('reports rc: null for a non-rc pre-release such as -dev.N', () => {
    assert.deepEqual(parseVersion('8.0.0-dev.7'), { major: 8, minor: 0, patch: 0, rc: null });
    assert.deepEqual(parseVersion('8.0.0-beta.1'), { major: 8, minor: 0, patch: 0, rc: null });
  });
});

describe('transitionLabel', () => {
  it('keys two stable versions on major.minor (unchanged from the historical labels)', () => {
    assert.equal(transitionLabel(parseVersion('0.7.0'), parseVersion('0.8.0')), '0.7-to-0.8');
    assert.equal(transitionLabel(parseVersion('0.16.0'), parseVersion('0.17.0')), '0.16-to-0.17');
    assert.equal(transitionLabel(parseVersion('0.7.3'), parseVersion('0.8.1')), '0.7-to-0.8');
  });
  it('keys a release candidate on its full version so RCs of one minor stay distinct', () => {
    assert.equal(
      transitionLabel(parseVersion('0.17.0'), parseVersion('8.0.0-rc.1')),
      '0.17-to-8.0.0-rc.1',
    );
    assert.equal(
      transitionLabel(parseVersion('8.0.0-rc.1'), parseVersion('8.0.0-rc.2')),
      '8.0.0-rc.1-to-8.0.0-rc.2',
    );
    assert.equal(
      transitionLabel(parseVersion('8.0.0-rc.1'), parseVersion('8.0.0-rc.7')),
      '8.0.0-rc.1-to-8.0.0-rc.7',
    );
  });
  it('keys the last release candidate to the stable release as rc.N → major.minor', () => {
    assert.equal(
      transitionLabel(parseVersion('8.0.0-rc.7'), parseVersion('8.0.0')),
      '8.0.0-rc.7-to-8.0',
    );
  });
});

describe('inFlightTransitionLabel', () => {
  it('returns head.minor → head.minor + 1 (function of head only)', () => {
    assert.equal(inFlightTransitionLabel(parseVersion('0.7.0')), '0.7-to-0.8');
    assert.equal(inFlightTransitionLabel(parseVersion('0.7.1')), '0.7-to-0.8');
    assert.equal(inFlightTransitionLabel(parseVersion('1.0.0')), '1.0-to-1.1');
  });
  it('returns rc.N → rc.N + 1 while head is on a release-candidate line', () => {
    assert.equal(inFlightTransitionLabel(parseVersion('8.0.0-rc.1')), '8.0.0-rc.1-to-8.0.0-rc.2');
    assert.equal(inFlightTransitionLabel(parseVersion('8.0.0-rc.9')), '8.0.0-rc.9-to-8.0.0-rc.10');
  });
  it('ignores a non-rc pre-release suffix and returns the next minor', () => {
    assert.equal(inFlightTransitionLabel(parseVersion('8.0.0-dev.7')), '8.0-to-8.1');
  });
});

describe('coverageTransitionChain', () => {
  it('PR-mode steady-state (prev.minor === head.minor): returns a single-element chain naming the in-flight directory', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('0.7.0'), parseVersion('0.7.0')), [
      '0.7-to-0.8',
    ]);
    assert.deepEqual(coverageTransitionChain(parseVersion('0.7.1'), parseVersion('0.7.0')), [
      '0.7-to-0.8',
    ]);
  });
  it('consecutive publish (head.minor === prev.minor + 1): returns the single prev → head step', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('0.7.0'), parseVersion('0.6.0')), [
      '0.6-to-0.7',
    ]);
  });
  it('skip-one publish (head.minor === prev.minor + 2): returns both consecutive steps in order', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('0.9.0'), parseVersion('0.7.0')), [
      '0.7-to-0.8',
      '0.8-to-0.9',
    ]);
  });
  it('skip-many publish (head.minor >> prev.minor + 1): returns every consecutive step', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('0.9.0'), parseVersion('0.5.0')), [
      '0.5-to-0.6',
      '0.6-to-0.7',
      '0.7-to-0.8',
      '0.8-to-0.9',
    ]);
  });
  it('major boundary: returns the existing single-step prev → head (minor counter resets; chain not composed across majors)', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('1.0.0'), parseVersion('0.99.0')), [
      '0.99-to-1.0',
    ]);
  });
  it('reversed RC range (head.rc < prev.rc): throws rather than naming a backwards transition', () => {
    assert.throws(
      () => coverageTransitionChain(parseVersion('8.0.0-rc.2'), parseVersion('8.0.0-rc.4')),
      (err) =>
        err instanceof Error &&
        /8\.0\.0-rc\.2/.test(err.message) &&
        /8\.0\.0-rc\.4/.test(err.message) &&
        /reversed|behind|chronological/i.test(err.message),
    );
  });
  it('a later base version with a reset RC counter is forward, not reversed', () => {
    assert.deepEqual(
      coverageTransitionChain(parseVersion('8.0.1-rc.1'), parseVersion('8.0.0-rc.9')),
      ['8.0.0-rc.9-to-8.0.1-rc.1'],
    );
  });
  it('an earlier base version with a higher RC counter is reversed', () => {
    assert.throws(
      () => coverageTransitionChain(parseVersion('8.0.0-rc.9'), parseVersion('8.0.1-rc.1')),
      /reversed|behind|chronological/i,
    );
  });
  it('an RC precedes its own release, and the release does not precede the RC', () => {
    assert.equal(comparePrecedence(parseVersion('8.0.0-rc.9'), parseVersion('8.0.0')) < 0, true);
    assert.throws(
      () => coverageTransitionChain(parseVersion('8.0.0-rc.9'), parseVersion('8.0.0')),
      /reversed|behind|chronological/i,
    );
  });
  it('reversed same-major range (head.minor < prev.minor): throws naming both versions instead of silently returning an empty chain', () => {
    assert.throws(
      () => coverageTransitionChain(parseVersion('0.7.0'), parseVersion('0.9.0')),
      (err) =>
        err instanceof Error &&
        /0\.7/.test(err.message) &&
        /0\.9/.test(err.message) &&
        /reversed|behind|chronological/i.test(err.message),
    );
  });
});

describe('coverageTransitionChain — release-candidate line', () => {
  it('entering the RC line from the last stable minor: single step naming the RC', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('8.0.0-rc.1'), parseVersion('0.17.0')), [
      '0.17-to-8.0.0-rc.1',
    ]);
  });
  it('consecutive RC publish: single step, one release is one step', () => {
    assert.deepEqual(
      coverageTransitionChain(parseVersion('8.0.0-rc.2'), parseVersion('8.0.0-rc.1')),
      ['8.0.0-rc.1-to-8.0.0-rc.2'],
    );
  });
  it('RC counters are never chained arithmetically, however far apart they are', () => {
    assert.deepEqual(
      coverageTransitionChain(parseVersion('8.0.0-rc.7'), parseVersion('8.0.0-rc.1')),
      ['8.0.0-rc.1-to-8.0.0-rc.7'],
    );
  });
  it('leaving the RC line for the stable release: single step from the last RC', () => {
    assert.deepEqual(coverageTransitionChain(parseVersion('8.0.0'), parseVersion('8.0.0-rc.7')), [
      '8.0.0-rc.7-to-8.0',
    ]);
  });
  it('PR-mode steady state on the RC line (prev === head): names the next RC directory', () => {
    assert.deepEqual(
      coverageTransitionChain(parseVersion('8.0.0-rc.1'), parseVersion('8.0.0-rc.1')),
      ['8.0.0-rc.1-to-8.0.0-rc.2'],
    );
  });
  it('the in-flight directory on rc.N is the directory the rc.N → rc.N+1 release requires', () => {
    const inFlight = inFlightTransitionLabel(parseVersion('8.0.0-rc.4'));
    assert.deepEqual(
      coverageTransitionChain(parseVersion('8.0.0-rc.5'), parseVersion('8.0.0-rc.4')),
      [inFlight],
    );
  });
});

describe('check-upgrade-coverage — coverage rule (publish style: prev.minor < head.minor)', () => {
  it('fails when the diff touches examples/ but the user-skill directory is absent', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /coverage/);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.6-to-0\.7/);
    assert.match(result.stderr, /examples\/demo\/src\/main\.ts/);
  });

  it('fails when the diff touches packages/3-extensions/ but the extension-skill directory is absent', () => {
    writePackageJson('0.6.0');
    writeRepoFile('packages/3-extensions/pgvector/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('packages/3-extensions/pgvector/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/extension\/upgrades\/0\.6-to-0\.7/);
  });

  it('requires both directories when both substrates change; passes once both are present', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    writeRepoFile('packages/3-extensions/pgvector/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    writeRepoFile('packages/3-extensions/pgvector/src/main.ts', 'b\n');
    commitAll('head-broken');

    // Neither directory present → both missing.
    const missingBoth = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingBoth.status, 0);
    assert.match(missingBoth.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.6-to-0\.7/);
    assert.match(
      missingBoth.stderr,
      /skills\/prisma-8\/upgrading\/extension\/upgrades\/0\.6-to-0\.7/,
    );

    // Add only the user-skill directory; extension-skill still missing.
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('add user-skill dir');
    const missingExt = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingExt.status, 0);
    assert.match(
      missingExt.stderr,
      /skills\/prisma-8\/upgrading\/extension\/upgrades\/0\.6-to-0\.7/,
    );
    assert.doesNotMatch(
      missingExt.stderr,
      /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.6-to-0\.7/,
    );

    // Add the extension-skill directory; both present → pass.
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('add ext-skill dir');
    const both = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(both.status, 0, `expected exit 0; stderr=${both.stderr}`);
  });

  it('publish mode: compares against the most recent v[0-9]* tag', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    git('tag', '-a', 'v0.6.0', '-m', 'v0.6.0');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head');
    const result = runScript(['--mode', 'publish', '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.6-to-0\.7/);
  });

  it('publish mode: default --prev skips pre-release tags and picks the last stable v[0-9]* tag', () => {
    // Models the real-world release-bump push: many dev tags live on
    // intermediate commits, and the bump commit's parent often carries
    // the latest dev tag. If default --prev resolved to the dev tag,
    // the diff would shrink to the bump alone — touching every
    // package.json but no instructions.md — and per-pr-declaration
    // would fire on a release that legitimately recorded every entry
    // earlier in the cycle.
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('v0.6.0 release');
    git('tag', '-a', 'v0.6.0', '-m', 'v0.6.0');
    // 0.6.x dev cycle: substrate change + matching instructions entry,
    // both authored mid-cycle.
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('feature with upgrade entry');
    git('tag', '-a', 'v0.6.0-dev.1', '-m', 'v0.6.0-dev.1');
    // Release bump on top: rewrites every package.json, touches no
    // instructions.md. The dev tag sits on the parent commit.
    writePackageJson('0.7.0');
    commitAll('bump to 0.7.0');
    const result = runScript(['--mode', 'publish', '--head', 'HEAD']);
    assert.equal(
      result.status,
      0,
      `expected exit 0 (default --prev should resolve to v0.6.0, not v0.6.0-dev.1); stderr=${result.stderr}`,
    );
  });
});

describe('check-upgrade-coverage — coverage rule (PR style: prev.minor === head.minor)', () => {
  it('PR with no version bump: coverage requires the in-flight directory (head → head+1)', () => {
    // Models the typical feature branch: package.json reads the
    // currently-published version (0.7.0) on both prev and head; the
    // breaking change is in-flight for the next release (0.7 → 0.8).
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.7-to-0\.8/);
    assert.doesNotMatch(result.stderr, /upgrades\/0\.6-to-0\.7/);
  });

  it('PR with a substrate diff and the matching in-flight directory present: passes', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('patch range with a substrate diff still requires an in-flight entry (no carve-out)', () => {
    // Under the corrected semantic, patch ranges aren't a special
    // case — a substrate diff is a substrate diff. If the patch is
    // genuinely consumer-invisible, the entry can ship `changes: []`.
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.1');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(
      result.status,
      0,
      `expected non-zero; stderr=${result.stderr}; stdout=${result.stdout}`,
    );
    assert.match(result.stderr, /upgrades\/0\.7-to-0\.8/);
  });

  it('no substrate diff: coverage rule is vacuously satisfied regardless of version', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.1');
    writeRepoFile('docs/notes.md', 'unrelated\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});

describe('check-upgrade-coverage — generated artefacts are NOT exempt from the substrate diff', () => {
  it('a contract.json change in examples/ requires an in-flight entry (format-change is an upgrade instruction)', () => {
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/prisma/contract.json', '{"v":1}\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/prisma/contract.json', '{"v":2}\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /upgrades\/0\.7-to-0\.8/);
    assert.match(result.stderr, /examples\/demo\/src\/prisma\/contract\.json/);
  });
});

describe('check-upgrade-coverage — new-entries rule', () => {
  it('rejects an added file under a stale transition directory (publish mode)', () => {
    // Simulates a publish-time check: prev tag at 0.7, head main tip
    // bumped to 0.8. A file added at upgrades/0.6-to-0.7/ is stale
    // (allowed transitions are 0.7-to-0.8 and 0.8-to-0.9).
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/new-script.ts',
      'export const x = 1;\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new-entries-stale-transition/);
    assert.match(result.stderr, /0\.6-to-0\.7\/new-script\.ts/);
    // Either of the allowed transitions should be mentioned.
    assert.match(result.stderr, /0\.7-to-0\.8|0\.8-to-0\.9/);
    // The "move the new file under" diagnostic should name both cluster paths.
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades/);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/extension\/upgrades/);
  });

  it('publish mode: accepts an added file under either prev→head or head→head+1', () => {
    // Both `0.7-to-0.8` (the release being shipped) and `0.8-to-0.9`
    // (the next in-flight) are valid landing spots in publish mode.
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.8-to-0.9/instructions.md',
      '---\nfrom: "0.8"\nto: "0.9"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('PR mode (skill-bootstrap): accepts an added placeholder under the in-flight directory', () => {
    // Mirrors the real-world tml-2519 case: a feature PR whose
    // package.json hasn't bumped (prev.minor = head.minor = 0.7)
    // adds the placeholder for the in-flight 0.7→0.8 transition.
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('PR mode: rejects an added placeholder under a stale transition directory', () => {
    // Same fixture as above but the placeholder lands in 0.6-to-0.7
    // (already-shipped transition); that's stale relative to head=0.7.
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new-entries-stale-transition/);
    assert.match(result.stderr, /0\.7-to-0\.8/);
    // The "move the new file under" diagnostic should name both cluster paths.
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades/);
    assert.match(result.stderr, /skills\/prisma-8\/upgrading\/extension\/upgrades/);
  });

  it('treats a git mv from outside the upgrades tree into a valid transition directory as a move, not an addition', () => {
    // Mirrors the real-world tml-2535 case: the upgrade instructions were
    // moved from packages/0-shared/upgrade-skill/ to skills/…
    // The gate must not flag the destination path as a "new entry in a stale
    // transition directory" just because the source path is outside the
    // watched pathspec.
    writePackageJson('0.7.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    // Simulate `git mv` by writing the file at the new path (same content)
    // and removing the old path. Git's rename detection (-M) infers the move.
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    git('rm', 'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md');
    git('add', 'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md');
    git('commit', '-m', 'move upgrade instructions to new cluster');

    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.doesNotMatch(result.stderr, /new-entries-stale-transition/);
  });

  it('accepts a modification to an existing file in a stale transition directory', () => {
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n# v1\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    // Same path — modification, not add.
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n# v2 — bug fix\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});

describe('check-upgrade-coverage — skip-publish chain (head.minor > prev.minor + 1)', () => {
  it('coverage: requires every consecutive transition directory; reports each missing one', () => {
    // Models the TML-2573 case: previously-published v0.7.0, head bumps to
    // 0.9.0 (v0.8 was bumped in-tree but never published). Coverage is
    // satisfied iff both `0.7-to-0.8/` and `0.8-to-0.9/` exist; the diagnostic
    // names each missing directory.
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.9.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head');

    const missingBoth = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingBoth.status, 0);
    assert.match(missingBoth.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.7-to-0\.8/);
    assert.match(missingBoth.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.8-to-0\.9/);
    assert.doesNotMatch(missingBoth.stderr, /upgrades\/0\.7-to-0\.9/);

    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('add 0.7-to-0.8');
    const missingSecond = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingSecond.status, 0);
    assert.match(missingSecond.stderr, /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.8-to-0\.9/);
    assert.doesNotMatch(
      missingSecond.stderr,
      /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.7-to-0\.8[^/]*$/m,
    );

    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.8-to-0.9/instructions.md',
      '---\nfrom: "0.8"\nto: "0.9"\nchanges: []\n---\n',
    );
    commitAll('add 0.8-to-0.9');
    const both = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(both.status, 0, `expected exit 0; stderr=${both.stderr}`);
  });

  it('new-entries: accepts an added file in any chain transition or in-flight', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.9.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.8-to-0.9/instructions.md',
      '---\nfrom: "0.8"\nto: "0.9"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.8-to-0.9/instructions.md',
      '---\nfrom: "0.8"\nto: "0.9"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.9-to-0.10/instructions.md',
      '---\nfrom: "0.9"\nto: "0.10"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('new-entries: rejects an added file in a pre-prev (stale) transition directory', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.9.0');
    // Coverage directories for the chain so coverage isn't the failure mode.
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.8-to-0.9/instructions.md',
      '---\nfrom: "0.8"\nto: "0.9"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.6-to-0.7/new-script.ts',
      'export const x = 1;\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new-entries-stale-transition/);
    assert.match(result.stderr, /0\.6-to-0\.7\/new-script\.ts/);
    assert.match(result.stderr, /0\.7-to-0\.8/);
    assert.match(result.stderr, /0\.8-to-0\.9/);
    assert.match(result.stderr, /0\.9-to-0\.10/);
  });

  it('--json envelope: one violation per missing chain directory', () => {
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.9.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD', '--json']);
    assert.notEqual(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    const coverageDirs = parsed.violations
      .filter((v) => v.rule === 'coverage' && v.substrate === 'examples/')
      .map((v) => v.requiredDir);
    assert.deepEqual(coverageDirs.sort(), [
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8',
      'skills/prisma-8/upgrading/app/upgrades/0.8-to-0.9',
    ]);
  });
});

describe('check-upgrade-coverage — release-candidate release PR', () => {
  it('an rc.1 → rc.2 release is covered by the directory the rc.1 branch treated as in-flight', () => {
    // The bump rewrites every package.json under examples/, so the
    // coverage rule fires on every RC release. It must ask for the
    // rc.1 → rc.2 directory — the one authored while main was on rc.1 —
    // and not for a directory named after a minor bump that never happens
    // on the RC line.
    writePackageJson('8.0.0-rc.1');
    writeRepoFile('examples/demo/package.json', '{"version":"8.0.0-rc.1"}\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    writePackageJson('8.0.0-rc.2');
    writeRepoFile('examples/demo/package.json', '{"version":"8.0.0-rc.2"}\n');
    commitAll('bump to 8.0.0-rc.2');

    const missing = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missing.status, 0);
    assert.match(
      missing.stderr,
      /skills\/prisma-8\/upgrading\/app\/upgrades\/8\.0\.0-rc\.1-to-8\.0\.0-rc\.2/,
    );
    assert.doesNotMatch(missing.stderr, /upgrades\/8\.0-to-8\.1/);

    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/instructions.md',
      '---\nfrom: "8.0.0-rc.1"\nto: "8.0.0-rc.2"\nchanges: []\n---\n',
    );
    commitAll('record the rc.1 → rc.2 entry');
    const covered = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(covered.status, 0, `expected exit 0; stderr=${covered.stderr}`);
  });

  it('a PR on the rc.1 line records into the rc.1 → rc.2 directory', () => {
    writePackageJson('8.0.0-rc.1');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/instructions.md',
      '---\nfrom: "8.0.0-rc.1"\nto: "8.0.0-rc.2"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});

describe('check-upgrade-coverage — in-flight minor source-of-truth', () => {
  it('reads the in-flight minor from package.json on the --head ref (not from npm or from main)', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    // Head A: version 0.7.0 → publish-style coverage (prev.minor 6 <
    // head.minor 7) requires upgrades/0.6-to-0.7/.
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head-0.7.0');
    const a = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(a.status, 0);
    assert.match(a.stderr, /upgrades\/0\.6-to-0\.7/);
    assert.doesNotMatch(a.stderr, /upgrades\/0\.5-to-0\.6/);

    // Head B: version 0.8.0 on a new commit → publish-style coverage
    // requires the full chain `0.6-to-0.7` + `0.7-to-0.8` because prev is
    // still at 0.6.0 (the chain spans every consecutive step from
    // prev.minor to head.minor).
    writePackageJson('0.8.0');
    writeRepoFile('examples/demo/src/main.ts', 'c\n');
    commitAll('head-0.8.0');
    const b = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(b.status, 0);
    assert.match(b.stderr, /upgrades\/0\.6-to-0\.7/);
    assert.match(b.stderr, /upgrades\/0\.7-to-0\.8/);
  });
});

describe('parseChangesFrontmatter', () => {
  it('returns an empty array for inline changes: []', () => {
    const result = parseChangesFrontmatter('---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n');
    assert.deepEqual(result, { ok: true, changes: [] });
  });

  it('returns a non-empty array for a block-sequence changes list', () => {
    const result = parseChangesFrontmatter(
      '---\nfrom: "0.10"\nto: "0.11"\nchanges:\n  - id: foo\n    summary: bar\n---\n',
    );
    assert.deepEqual(result, { ok: true, changes: [{ id: 'foo' }] });
  });

  it('returns ok:false when changes key is absent', () => {
    const result = parseChangesFrontmatter('---\nfrom: "0.7"\nto: "0.8"\n---\n');
    assert.equal(result.ok, false);
  });

  it('returns ok:false when the frontmatter block is missing entirely', () => {
    const result = parseChangesFrontmatter('# No frontmatter here\n');
    assert.equal(result.ok, false);
  });

  it('(finding 1) non-empty flow array with one element: changes: [foo] is ok with length 1', () => {
    const result = parseChangesFrontmatter('---\nchanges: [foo]\n---\n');
    assert.equal(result.ok, true);
    assert.equal(result.changes.length, 1);
  });

  it('(finding 1) non-empty flow array with multiple elements: changes: [a, b] is ok with length >= 1', () => {
    const result = parseChangesFrontmatter('---\nchanges: [a, b]\n---\n');
    assert.equal(result.ok, true);
    assert.ok(result.changes.length >= 1);
  });

  it('(finding 1) regression: empty flow array changes: [] still returns ok:true with length 0', () => {
    const result = parseChangesFrontmatter('---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n');
    assert.equal(result.ok, true);
    assert.equal(result.changes.length, 0);
  });

  it('(finding 2) block entry whose first key is summary (not id) is ok with length >= 1', () => {
    const result = parseChangesFrontmatter('---\nchanges:\n  - summary: foo\n    id: bar\n---\n');
    assert.equal(result.ok, true);
    assert.ok(result.changes.length >= 1);
  });

  it('(regression) absent changes: key still returns ok:false', () => {
    const result = parseChangesFrontmatter('---\nfrom: "0.7"\nto: "0.8"\n---\n');
    assert.equal(result.ok, false);
  });
});

describe('check-upgrade-coverage — per-PR correspondence rule', () => {
  it('substrate touched + in-flight instructions.md NOT in diff → violation', () => {
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('prev — directory already exists');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head — substrate touched but instructions.md unchanged');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
    assert.match(
      result.stderr,
      /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.7-to-0\.8\/instructions\.md/,
    );
  });

  it('substrate touched + instructions.md in diff with non-empty changes[] → pass', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges:\n  - id: my-change\n    summary: Some migration step.\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('substrate touched + instructions.md in diff with changes: [] → pass (incidental diff)', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('substrate NOT touched → no per-PR-declaration requirement (no false positive)', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('docs/notes.md', 'unrelated\n');
    commitAll('head — no substrate diff');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('both clusters touched → each independently requires its own declaration', () => {
    // Both transition directories exist before this PR (committed in prev),
    // so the directory-existence coverage check passes. The per-PR
    // correspondence check then fires independently for each cluster.
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('prev — both directories already exist');
    const prev = git('rev-parse', 'HEAD');

    // Both substrates changed but only user-skill instructions.md updated.
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    writeRepoFile('packages/3-extensions/pgvector/src/main.ts', 'b\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\nupdated\n',
    );
    commitAll('head — only user-skill instructions.md updated');
    const missingExt = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingExt.status, 0);
    assert.match(missingExt.stderr, /per-pr-declaration/);
    assert.match(
      missingExt.stderr,
      /skills\/prisma-8\/upgrading\/extension\/upgrades\/0\.7-to-0\.8\/instructions\.md/,
    );
    assert.doesNotMatch(
      missingExt.stderr,
      /skills\/prisma-8\/upgrading\/app\/upgrades\/0\.7-to-0\.8\/instructions\.md/,
    );

    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\nupdated\n',
    );
    commitAll('head — both instructions.md updated');
    const both = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(both.status, 0, `expected exit 0; stderr=${both.stderr}`);
  });

  it('instructions.md in diff but changes key absent → violation', () => {
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\n---\n',
    );
    commitAll('head — instructions.md missing changes key');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });
});

describe('check-upgrade-coverage — translation-irrelevant substrate diffs need no declaration', () => {
  function seedTransitionDir() {
    writePackageJson('0.7.0');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    writeRepoFile(
      'skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
  }

  function exampleManifest(deps) {
    return `${JSON.stringify({ name: 'demo', devDependencies: deps }, null, 2)}\n`;
  }

  it('a version-only bump in an example manifest passes without touching instructions.md', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^6.0.0' }));
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4' }));
    commitAll('head — dependency version bump only');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('arbitrary scripts-only manifest changes pass without touching instructions.md', () => {
    seedTransitionDir();
    writeRepoFile(
      'examples/demo/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          scripts: { build: 'vite build', lint: 'biome check .' },
          devDependencies: { vite: '^8.1.4' },
        },
        null,
        2,
      )}\n`,
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile(
      'examples/demo/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          scripts: { build: 'vite build --watch', dev: 'vite dev' },
          devDependencies: { vite: '^8.1.4' },
        },
        null,
        2,
      )}\n`,
    );
    commitAll('head — arbitrary scripts only');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('removing the final manifest script passes without touching instructions.md', () => {
    seedTransitionDir();
    writeRepoFile(
      'examples/demo/package.json',
      `${JSON.stringify(
        {
          name: 'demo',
          scripts: { build: 'vite build' },
          devDependencies: { vite: '^8.1.4' },
        },
        null,
        2,
      )}\n`,
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4' }));
    commitAll('head — final script removed');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('a $schema realignment in an extension biome config passes without touching instructions.md', () => {
    seedTransitionDir();
    const config = (v) =>
      `{\n  // linter config\n  "$schema": "https://biomejs.dev/schemas/${v}/schema.json"\n}\n`;
    writeRepoFile('packages/3-extensions/pgvector/biome.jsonc', config('2.5.7'));
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('packages/3-extensions/pgvector/biome.jsonc', config('2.5.8'));
    commitAll('head — schema URL realignment only');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('test infrastructure changes pass without touching instructions.md', () => {
    seedTransitionDir();
    writeRepoFile(
      'examples/demo/test/e2e.integration.test.ts',
      "describe.sequential('demo', () => {});\n",
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/package.json',
      `${JSON.stringify(
        {
          name: 'pgvector',
          scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
        },
        null,
        2,
      )}\n`,
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/vitest.config.ts',
      "export default { test: { coverage: { provider: 'v8' } } };\n",
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/test/codec.integration.test.ts',
      "describe.sequential('codec', () => {});\n",
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    writeRepoFile(
      'examples/demo/test/e2e.integration.test.ts',
      "describe('demo', { concurrent: false }, () => {});\n",
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/package.json',
      `${JSON.stringify({ name: 'pgvector', scripts: { test: 'vitest run' } }, null, 2)}\n`,
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/vitest.config.ts',
      'export default { test: {} };\n',
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/coverage.config.json',
      '{"include":["src/**/*.ts"],"exclude":[],"thresholds":{}}\n',
    );
    writeRepoFile(
      'packages/3-extensions/pgvector/test/codec.integration.test.ts',
      "describe('codec', { concurrent: false }, () => {});\n",
    );
    commitAll('head — test infrastructure migration');

    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('a Prisma config change remains translation-relevant', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/prisma.config.ts', 'export default { migrations: "a" };\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/prisma.config.ts', 'export default { migrations: "b" };\n');
    commitAll('head — user-facing config changed');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });

  it('a filename merely ending in biome.json is not a biome config', () => {
    seedTransitionDir();
    const config = (v) => `{\n  "$schema": "https://biomejs.dev/schemas/${v}/schema.json"\n}\n`;
    writeRepoFile('examples/demo/notbiome.json', config('2.5.7'));
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/notbiome.json', config('2.5.8'));
    commitAll('head — a non-biome file whose name ends in biome.json');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });

  it('a filename merely ending in package.json is not a manifest', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/not-package.json', '{"devDependencies":{"vite":"^6.0.0"}}\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/not-package.json', '{"devDependencies":{"vite":"^8.1.4"}}\n');
    commitAll('head — a non-manifest file whose name ends in package.json');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });

  it('adding a dependency still requires a declaration', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4' }));
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4', zod: '^3.0.0' }));
    commitAll('head — new dependency');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });

  it('a source change alongside a version bump still requires a declaration', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^6.0.0' }));
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4' }));
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head — bump plus source');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });

  it('a non-script manifest field still requires a declaration', () => {
    seedTransitionDir();
    writeRepoFile('examples/demo/package.json', exampleManifest({ vite: '^8.1.4' }));
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writeRepoFile(
      'examples/demo/package.json',
      `${JSON.stringify(
        { name: 'demo', type: 'module', devDependencies: { vite: '^8.1.4' } },
        null,
        2,
      )}\n`,
    );
    commitAll('head — non-script manifest field added');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });
});

describe('manifestShapeIgnoringVersions', () => {
  const manifest = (version, deps) =>
    JSON.stringify({ name: 'fixture', version, dependencies: deps });

  it('a release sweep compares equal only when the own version is ignored', () => {
    const before = manifest('8.0.0-rc.3', { '@prisma/orm-postgres': 'workspace:8.0.0-rc.3' });
    const after = manifest('8.0.0-rc.4', { '@prisma/orm-postgres': 'workspace:8.0.0-rc.4' });
    assert.notEqual(manifestShapeIgnoringVersions(before), manifestShapeIgnoringVersions(after));
    assert.equal(
      manifestShapeIgnoringVersions(before, true),
      manifestShapeIgnoringVersions(after, true),
    );
  });

  it('an added dependency compares unequal — a new name can signal an API change', () => {
    const before = manifest('1.0.0', {});
    const after = manifest('1.0.0', { 'left-pad': '^1.0.0' });
    assert.notEqual(manifestShapeIgnoringVersions(before), manifestShapeIgnoringVersions(after));
  });

  it('a changed script compares unequal even when versions are ignored', () => {
    const before = JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { emit: 'a' } });
    const after = JSON.stringify({ name: 'fixture', version: '2.0.0', scripts: { emit: 'b' } });
    assert.notEqual(
      manifestShapeIgnoringVersions(before, true),
      manifestShapeIgnoringVersions(after, true),
    );
  });
});

describe('check-upgrade-coverage — release sweep per-PR declaration', () => {
  it('a version-only sweep needs the transition directory but no fresh declaration', () => {
    writePackageJson('8.0.0-rc.3');
    writeRepoFile('examples/demo/package.json', '{"name":"demo","version":"8.0.0-rc.3"}\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.3-to-8.0.0-rc.4/instructions.md',
      '---\nfrom: "8.0.0-rc.3"\nto: "8.0.0-rc.4"\nchanges: []\n---\n',
    );
    commitAll('prev, directory already recorded by an earlier PR');
    const prev = git('rev-parse', 'HEAD');

    writePackageJson('8.0.0-rc.4');
    writeRepoFile('examples/demo/package.json', '{"name":"demo","version":"8.0.0-rc.4"}\n');
    commitAll('bump to 8.0.0-rc.4');

    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('a sweep with a real substrate change still demands the declaration', () => {
    writePackageJson('8.0.0-rc.3');
    writeRepoFile('examples/demo/package.json', '{"name":"demo","version":"8.0.0-rc.3"}\n');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    writeRepoFile(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.3-to-8.0.0-rc.4/instructions.md',
      '---\nfrom: "8.0.0-rc.3"\nto: "8.0.0-rc.4"\nchanges: []\n---\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    writePackageJson('8.0.0-rc.4');
    writeRepoFile('examples/demo/package.json', '{"name":"demo","version":"8.0.0-rc.4"}\n');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('bump with substrate change');

    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /per-pr-declaration/);
  });
});
