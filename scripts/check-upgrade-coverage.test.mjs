import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  comparePrecedence,
  manifestShapeIgnoringVersions,
  parseChangesFrontmatter,
  parseVersion,
  transitionLabel,
} from './check-upgrade-coverage.mjs';

const script = fileURLToPath(new URL('./check-upgrade-coverage.mjs', import.meta.url));
const empty = '---\nchanges: []\n---\n';
const pending = (name, audience = 'app') =>
  `upgrade-instructions/pending/${name}/${audience}/instructions.md`;
const guide = (transition, audience = 'app') =>
  `skills/prisma-8/upgrading/${audience}/upgrades/${transition}/instructions.md`;
let repo;
function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function write(path, content = empty) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}
function version(value) {
  write('package.json', JSON.stringify({ version: value }));
}
function commit() {
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return git('rev-parse', 'HEAD');
}
function check(prev, ...args) {
  return spawnSync(process.execPath, [script, ...(prev ? ['--prev', prev] : []), ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
}
function passes(prev, ...args) {
  const result = check(prev, ...args);
  assert.equal(result.status, 0, result.stderr);
}
function fails(prev, pattern, ...args) {
  const result = check(prev, ...args);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, pattern);
}
function guides(transition) {
  for (const audience of ['app', 'extension']) write(guide(transition, audience));
}
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'upgrade-coverage-'));
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  version('0.7.0');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('version and format helpers', () => {
  it('preserves stable, RC and non-RC parsing', () => {
    assert.deepEqual(parseVersion('8.0.0-rc.3'), { major: 8, minor: 0, patch: 0, rc: 3 });
    assert.equal(parseVersion('8.0.0-dev.7').rc, null);
    assert.throws(() => parseVersion('invalid'));
    assert.equal(transitionLabel(parseVersion('0.7.3'), parseVersion('0.9.0')), '0.7-to-0.9');
    assert.equal(
      transitionLabel(parseVersion('8.0.0-rc.7'), parseVersion('8.0.0')),
      '8.0.0-rc.7-to-8.0',
    );
    assert.ok(comparePrecedence(parseVersion('8.0.0-rc.9'), parseVersion('8.0.1-rc.1')) < 0);
    assert.ok(comparePrecedence(parseVersion('8.0.0-rc.9'), parseVersion('8.0.0')) < 0);
  });
  it('reads empty, flow and block lists without enforcing entry schemas', () => {
    for (const value of ['[]', '[foo]', '[a, b]', '\n  - summary: prose\n    id: x'])
      assert.equal(parseChangesFrontmatter(`---\nchanges: ${value}\n---\n`).ok, true);
    for (const source of ['no frontmatter', '---\nother: []\n---', '---\nchanges: nope\n---'])
      assert.equal(parseChangesFrontmatter(source).ok, false);
  });
  it('normalizes dependency versions but retains names and optional own version', () => {
    const manifest = (version, dependencies) => JSON.stringify({ version, dependencies });
    const a = manifest('1.0.0', { foo: '1' });
    const b = manifest('2.0.0', { foo: '2' });
    assert.notEqual(manifestShapeIgnoringVersions(a), manifestShapeIgnoringVersions(b));
    assert.equal(manifestShapeIgnoringVersions(a, true), manifestShapeIgnoringVersions(b, true));
    assert.notEqual(
      manifestShapeIgnoringVersions(a, true),
      manifestShapeIgnoringVersions(manifest('1.0.0', {}), true),
    );
  });
});

describe('independent PR declarations', () => {
  for (const [audience, changedFile] of [
    ['app', 'examples/demo.ts'],
    ['extension', 'packages/3-extensions/pack/src.ts'],
  ]) {
    it(`accepts a new no-op ${audience} without a transition`, () => {
      const base = commit();
      write(changedFile, 'changed');
      write(pending('feature', audience));
      commit();
      passes(base);
    });
    it(`rejects inherited and modified ${audience} declarations`, () => {
      write(pending('existing', audience));
      const base = commit();
      write(changedFile, 'changed');
      commit();
      fails(base, /per-pr-declaration/);
      write(pending('existing', audience), `${empty}changed\n`);
      commit();
      fails(base, /per-pr-declaration/);
    });
  }
  it('requires both audiences independently, including real/no-op pairs', () => {
    const base = commit();
    write('examples/demo.ts', 'a');
    write('packages/3-extensions/pack/src.ts', 'a');
    write(pending('feature'), '---\nchanges:\n  - id: real\n---\n');
    commit();
    fails(base, /pending\/<name>\/extension/);
    write(pending('feature', 'extension'));
    commit();
    passes(base);
  });
  it('does not let a changed shared guide substitute for a declaration', () => {
    const base = commit();
    write('examples/demo.ts', 'a');
    write(guide('0.7-to-0.8'));
    commit();
    fails(base, /pending/);
  });
  it('counts a new identical no-op even when Git infers a rename', () => {
    write('old.md');
    const base = commit();
    git('rm', 'old.md');
    write(pending('new'));
    write('examples/demo.ts', 'a');
    commit();
    passes(base);
  });
  it('supports independent and stacked branches against the actual target', () => {
    const base = commit();
    git('checkout', '-qb', 'first');
    write(pending('first'));
    write('examples/first.ts', 'a');
    const first = commit();
    passes(base);
    git('checkout', '-qb', 'stacked');
    write('examples/second.ts', 'b');
    commit();
    fails(first, /per-pr-declaration/);
    write(pending('second'));
    commit();
    passes(first);
    git('checkout', '-qb', 'independent', base);
    write(pending('independent'));
    write('examples/third.ts', 'c');
    commit();
    passes(base);
  });
  it('keeps fragment paths across a rebase after release', () => {
    const base = commit();
    git('checkout', '-qb', 'feature');
    write(pending('feature'));
    write('examples/demo.ts', 'a');
    commit();
    git('checkout', 'main');
    version('0.8.0');
    guides('0.7-to-0.8');
    const release = commit();
    git('checkout', 'feature');
    git('rebase', '--onto', release, base);
    passes(release);
  });
  it('uses checked refs rather than an unrelated worktree', () => {
    const base = commit();
    write('examples/demo.ts', 'a');
    const missing = commit();
    write(pending('feature'));
    const covered = commit();
    passes(base, '--head', covered);
    fails(base, /pending/, '--head', missing);
    git('checkout', base);
    passes(base, '--head', covered);
  });
});

describe('release completeness', () => {
  it('uses the last published version when the target branch contains an unpublished bump', () => {
    commit();
    git('tag', 'v0.7.0');
    version('0.8.0');
    const base = commit();
    version('0.9.0');
    guides('0.7-to-0.9');
    commit();
    passes(base);
    passes(null, '--mode', 'publish');
  });
  it('requires both guides even without example or extension changes and supports skipped releases', () => {
    const base = commit();
    version('0.9.0');
    commit();
    fails(base, /0\.7-to-0\.9/);
    write(guide('0.7-to-0.9'));
    commit();
    fails(base, /extension/);
    guides('0.7-to-0.9');
    commit();
    passes(base);
  });
  for (const path of [
    pending('late'),
    pending('late', 'extension'),
    'upgrade-instructions/pending/late/arbitrary.bin',
  ]) {
    it(`blocks late pending ${path} on release PR and publication`, () => {
      const base = commit();
      version('0.8.0');
      guides('0.7-to-0.8');
      commit();
      write(path);
      commit();
      fails(base, /pending/, '--mode', 'pr');
      fails(base, /pending/, '--mode', 'publish');
    });
  }
  it('checks the effective merge group, not only the assembled release branch', () => {
    const base = commit();
    git('checkout', '-qb', 'release');
    version('0.8.0');
    guides('0.7-to-0.8');
    commit();
    git('checkout', 'main');
    write(pending('late'));
    commit();
    git('checkout', 'release');
    git('merge', '--no-edit', 'main');
    fails(base, /pending/);
  });
  it('permits historical fixes/assets and ignores archive originals and unchanged old guides', () => {
    write(guide('0.5-to-0.6'), 'legacy');
    const base = commit();
    write('upgrade-instructions/releases/0.6-to-0.7/sources/old/app/instructions.md', 'legacy');
    write(guide('0.4-to-0.5'));
    write('skills/prisma-8/upgrading/app/upgrades/0.4-to-0.5/script.ts', 'asset');
    commit();
    passes(base);
    write(guide('0.5-to-0.6'));
    commit();
    passes(base);
  });
  it('rejects reversed stable, major, patch and RC ranges', () => {
    for (const value of ['0.6.0', '0.7.0-rc.1', '0.0.9']) {
      const base = commit();
      version(value);
      commit();
      assert.equal(check(base).status, 2);
      version('0.7.0');
    }
  });
  it('publish is always release, even when explicit refs have equal versions', () => {
    const base = commit();
    write(pending('feature'));
    commit();
    fails(base, /pending/, '--mode', 'publish');
  });
});

describe('narrow guide validation', () => {
  it('checks script references in flow-style change lists', () => {
    const base = commit();
    write(pending('flow'), '---\nchanges: [{id: migrate, script: scripts/missing.ts}]\n---\n');
    commit();
    fails(base, /script-reference/);
    write('upgrade-instructions/pending/flow/app/scripts/missing.ts', 'code');
    commit();
    passes(base);
  });
  it('rejects trailing garbage after an empty change list', () => {
    const base = commit();
    write(pending('malformed'), '---\nchanges: [] garbage\n---\n');
    commit();
    fails(base, /instructions-format/);
  });
  it('rejects removal of a script referenced by an unchanged published guide', () => {
    const location = guide('0.5-to-0.6');
    const asset = join(dirname(location), 'scripts/update.ts');
    write(location, '---\nchanges:\n  - id: update\n    script: scripts/update.ts\n---\n');
    write(asset, 'code');
    const base = commit();
    git('rm', asset);
    commit();
    fails(base, /script-reference/);
  });
  for (const location of [pending('feature'), guide('0.5-to-0.6')]) {
    it(`rejects malformed changes at ${location}`, () => {
      const base = commit();
      write(location, '---\nchanges: nope\n---\n');
      commit();
      fails(base, /changes/);
    });
    for (const reference of [
      'scripts/missing.ts',
      '../outside.ts',
      '/absolute.ts',
      'https://example.com/run.ts',
    ]) {
      it(`rejects script ${reference} at ${location}`, () => {
        const base = commit();
        write(location, `---\nchanges:\n  - id: x\n    script: ${reference}\n---\n`);
        write(join(dirname(location), '../outside.ts'), 'exists');
        commit();
        fails(base, /script/);
      });
    }
    it(`accepts quoted script names and comments at ${location}`, () => {
      const base = commit();
      write(
        location,
        `---\nchanges:\n  - id: x\n    script: "scripts/a # b.ts" # comment\n  - id: y\n    script: 'scripts/it''s.ts'\n---\n`,
      );
      write(join(dirname(location), 'scripts/a # b.ts'), 'code');
      write(join(dirname(location), "scripts/it's.ts"), 'code');
      commit();
      passes(base);
    });
  }
  it('validates all present pending instructions, even inherited ones', () => {
    write(pending('old'), 'broken');
    const base = commit();
    write('docs/note', 'a');
    commit();
    fails(base, /changes|frontmatter/);
  });
  it('dev validates pending references without requiring declarations or release completeness', () => {
    const base = commit();
    version('0.8.0');
    write('examples/demo.ts', 'a');
    write(pending('feature'));
    commit();
    passes(base, '--mode', 'dev');
    passes(null, '--mode', 'dev');
    write(pending('feature'), 'broken');
    commit();
    fails(null, /frontmatter/, '--mode', 'dev');
  });
});

describe('publish defaults and CLI', () => {
  for (const [from, to, label] of [
    ['0.7.0', '0.9.0', '0.7-to-0.9'],
    ['8.0.0-rc.1', '8.0.0-rc.7', '8.0.0-rc.1-to-8.0.0-rc.7'],
    ['8.0.0-rc.7', '8.0.0', '8.0.0-rc.7-to-8.0'],
  ]) {
    it(`resolves ${label}, skips dev/beta and supports already-tagged republish`, () => {
      version(from);
      commit();
      git('tag', `v${from}`);
      write('dev-note', 'a');
      commit();
      git('tag', 'v9.0.0-dev.1');
      write('beta-note', 'a');
      commit();
      git('tag', 'v9.0.0-beta.1');
      version(to);
      guides(label);
      const release = commit();
      passes(null, '--mode', 'publish');
      git('tag', `v${to}`);
      passes(null, '--mode', 'publish');
      version('99.0.0');
      commit();
      git('tag', 'v99.0.0');
      passes(null, '--mode', 'publish', '--head', release);
    });
  }
  it('fails closed on unsupported modes, flags and missing values', () => {
    commit();
    for (const args of [
      ['--mode', 'other'],
      ['--mode'],
      ['--head'],
      ['--prev'],
      ['--wat'],
      ['--prev', '--json'],
    ])
      assert.equal(check(null, ...args).status, 2);
  });
});

describe('translation exclusions', () => {
  const cases = [
    [
      'examples/demo/package.json',
      '{"dependencies":{"foo":"1"}}',
      '{"dependencies":{"foo":"2"}}',
      true,
    ],
    ['examples/demo/package.json', '{"scripts":{"build":"a"}}', '{}', true],
    ['packages/3-extensions/pack/biome.jsonc', '{"$schema":"a"}', '{"$schema":"b"}', true],
    ['examples/demo/test/a.ts', 'a', 'b', true],
    ['packages/3-extensions/pack/vitest.config.ts', 'a', 'b', true],
    ['examples/demo/coverage.config.json', '{}', '{"new":true}', true],
    [
      'examples/demo/contract.json',
      '{"targetId":"postgres","version":"1"}',
      '{"targetId":"postgres","version":"2"}',
      true,
    ],
    [
      'examples/demo/contract.d.ts',
      "readonly targetId: 'postgres'; readonly version: '1';",
      "readonly targetId: 'postgres'; readonly version: '2';",
      true,
    ],
    ['examples/demo/package.json', '{"dependencies":{}}', '{"dependencies":{"foo":"1"}}', false],
    ['examples/demo/package.json', '{}', '{"type":"module"}', false],
    [
      'examples/demo/not-package.json',
      '{"dependencies":{"foo":"1"}}',
      '{"dependencies":{"foo":"2"}}',
      false,
    ],
    ['examples/demo/notbiome.json', '{"$schema":"a"}', '{"$schema":"b"}', false],
    ['examples/demo/prisma.config.ts', 'a', 'b', false],
    ['examples/demo/contract.json', '{"models":{}}', '{"models":{"User":{}}}', false],
  ];
  for (const [path, before, after, exempt] of cases)
    it(`${exempt ? 'exempts' : 'requires declaration for'} ${path}: ${after}`, () => {
      write(path, before);
      const base = commit();
      write(path, after);
      commit();
      if (exempt) passes(base);
      else fails(base, /per-pr-declaration/);
    });
});
