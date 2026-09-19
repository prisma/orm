import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { allowanceFor } from './lint-legacy-name.mjs';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-legacy-name.mjs');

/**
 * The name this check forbids, assembled rather than written out.
 *
 * Every fixture below plants it on purpose. Spelled literally, a repo-wide
 * rename sweep would rewrite these the way it rewrites real code, and each
 * negative test would go on passing while asserting nothing. Same reason
 * `test/integration/test/cli-journeys/migration-new-import-root.e2e.test.ts`
 * builds its package names from constants.
 */
const LEGACY = ['prisma', 'next'].join('-');
const SCOPE = `@${LEGACY}/`;

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
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-legacy-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write('README.md', 'Prisma 8\n');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('what the check forbids', () => {
  it('fails on the old package scope, naming the file and line', () => {
    write('src/db.ts', `import { orm } from '${SCOPE}sql-orm-client';\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /src\/db\.ts:1:/);
  });

  it('fails on a directory or package named after the old product', () => {
    write(`examples/${LEGACY}-widget/package.json`, `{ "name": "${LEGACY}-widget" }\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, new RegExp(`${LEGACY}-widget`));
  });

  it('fails on a link to the old repository that names no PR or issue', () => {
    write('CONTRIBUTING.md', `File issues at https://github.com/prisma/${LEGACY}/discussions.\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /CONTRIBUTING\.md:1:/);
  });

  it('lists every allowance when it fails, so the reader can see which ones exist', () => {
    write('src/db.ts', `import x from '${SCOPE}contract';\n`);
    const result = run();
    assert.match(result.stderr, /dated record of past work/);
    assert.match(result.stderr, /retired name kept only to prove it stays gone/);
  });

  it('fails on the retired schema header, primer file, and skill directory names', () => {
    write('src/schema.prisma', `// use ${LEGACY}\n`);
    write('docs/quickstart.md', `Open \`${LEGACY}.md\` for the quick reference.\n`);
    write(`skills/${LEGACY}-queries/SKILL.md`, `name: ${LEGACY}-queries\n`);
    const result = run();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stderr, /src\/schema\.prisma:1:/);
    assert.match(result.stderr, /docs\/quickstart\.md:1:/);
    assert.match(result.stderr, new RegExp(`skills/${LEGACY}-queries/SKILL\\.md:1:`));
  });
});

describe('what the check allows', () => {
  it('passes a clean tree', () => {
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows the changelog and the release notes', () => {
    write('CHANGELOG.md', `Published as \`${SCOPE}cli\` in v0.16.0.\n`);
    write('docs/releases/v0.16.0.md', `Upgrade \`${SCOPE}postgres\` to 0.16.\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows ADRs and the project and drive write-ups', () => {
    write('docs/architecture docs/adrs/ADR 211 - shim.md', `The \`${SCOPE}cli\` dist is copied.\n`);
    write('projects/some-project/spec.md', `Depends on \`${SCOPE}emitter\`.\n`);
    write('drive/retro/findings.md', `The \`${LEGACY}-ws\` checkout was stale.\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows a link that names a pull request or issue by number', () => {
    write('docs/notes.md', `Landed as [#1023](https://github.com/prisma/${LEGACY}/pull/1023).\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows a Linear URL whose generated slug carries the old name', () => {
    write(
      'docs/notes.md',
      `Tracked at [TML-2677](https://linear.app/prisma-company/issue/TML-2677/add-${LEGACY}sqliteconfig-wrapper).\n`,
    );
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows a link to an ADR whose filename carries the old name', () => {
    write(
      'docs/notes.md',
      `See [ADR 211](../architecture%20docs/adrs/ADR%20211%20-%20${LEGACY}%20bin-only%20distribution.md).\n`,
    );
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows the third-party package published under the old name', () => {
    write('README.md', `Prisma 8\n\n- \`@cipherstash/${LEGACY}\`: searchable encryption.\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('allows the files that keep the retired name only to prove it stays gone', () => {
    const proof = 'packages/1-framework/3-tooling/cli/src/commands/init/skill-sources.ts';
    write(proof, `export const RETIRED_SKILL_NAMES = ['${LEGACY}-queries'];\n`);
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(allowanceFor(proof, `'${LEGACY}-queries'`).why, /prove it stays gone/);
  });

  it('allows the gotcha logs and the shipped upgrade instructions as dated records', () => {
    write('examples/demo/gotchas.md', `Ran \`${LEGACY} migrate\` and it failed.\n`);
    write(
      'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.1-to-8.0.0-rc.2/instructions.md',
      `- id: published-${LEGACY}-bin-retired\n`,
    );
    const result = run();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});
