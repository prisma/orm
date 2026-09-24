import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-graph-tip.mjs');

/** Assembled so a repo-wide rename of the retired names cannot rewrite these fixtures. */
const CODE = ['MIGRATION', 'AMBIGUOUS_TARGET'].join('.');
const HELPER = ['find', 'Leaf'].join('');

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function run() {
  git('add', '-A');
  git('commit', '-m', 'fixture');
  return spawnSync(execPath, [SCRIPT_PATH], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-graph-tip-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write('packages/cli/src/index.ts', 'export const ok = true;\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('what the check forbids', () => {
  it('fails on the removed error code under packages/, naming the file and line', () => {
    write('packages/cli/src/errors.ts', `throw new Error('${CODE}');\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /packages\/cli\/src\/errors\.ts:1:/);
  });

  it('fails on the removed helper name under docs/ and skills/', () => {
    write('docs/reference/graph.md', `Call \`${HELPER}(graph)\` to find the tip.\n`);
    write('skills/prisma-8/SKILL.md', `Route \`${CODE}\` to migration-review.\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /docs\/reference\/graph\.md:1:/);
    assert.match(result.stderr, /skills\/prisma-8\/SKILL\.md:1:/);
  });
});

describe('what the check allows', () => {
  it('passes a clean tree', () => {
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows ADRs and release notes as dated records', () => {
    write('docs/architecture docs/adrs/ADR 169 - graph.md', `\`${HELPER}\` threw \`${CODE}\`.\n`);
    write('docs/releases/v8.0.0.md', `Removed \`${CODE}\`.\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('ignores files outside packages/, docs/ and skills/', () => {
    write('CHANGELOG.md', `Removed \`${CODE}\` and \`${HELPER}\`.\n`);
    write('scripts/note.mjs', `// ${HELPER}\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});
