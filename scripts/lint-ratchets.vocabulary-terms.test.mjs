import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = join(fileURLToPath(new URL('.', import.meta.url)), 'lint-ratchets.mjs');

const SCOPE = 'packages/1-framework';

// Every term the plugin forbids, in the forms its regexes accept. The plugin
// checks substring stems before the regexes, so a stem that misses a term
// would drop it silently; one line per term makes that visible.
const FORBIDDEN_TERMS = [
  'postgres',
  'PostgreSQL',
  'sqlite',
  'MySQL',
  'mariadb',
  'mssql',
  'SQLSERVER',
  'cockroach',
  'pglite',
  'mongo',
  'MongoDB',
  'collection',
  'column',
  'table',
  'constraint',
  'sql',
  'varchar',
  'jsonb',
  'dialect',
  'rls',
  'nativeType',
  'native_type',
  'primaryKey',
  'primary-key',
  'foreignKey',
  'FOREIGN_KEY',
  'prisma7',
  'Prisma 6',
  'poſtgres',
];

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function runList(threshold) {
  writeRepoFile(
    'scripts/framework-vocabulary-thresholds.json',
    JSON.stringify({ scopes: [{ path: SCOPE, threshold }] }),
  );
  git('add', '-A');
  git('commit', '--quiet', '-m', 'fixture');
  return spawnSync(execPath, [SCRIPT_PATH, '--list'], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-ratchets-terms-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('lint-ratchets — vocabulary terms', () => {
  it('counts every forbidden term', () => {
    writeRepoFile(
      `${SCOPE}/src/terms.ts`,
      FORBIDDEN_TERMS.map((term, i) => `export const t${i} = '${term}';\n`).join(''),
    );

    const result = runList(FORBIDDEN_TERMS.length);
    assert.equal(result.status, 0, `expected exit 0; stdout=${result.stdout}`);
    for (const [i, term] of FORBIDDEN_TERMS.entries()) {
      assert.match(result.stdout, new RegExp(`src/terms\\.ts:${i + 1}\\n`), `missed ${term}`);
    }
  });
});

describe('lint-ratchets — vocabulary scope', () => {
  it('counts only files under the scope path, not paths that merely contain it', () => {
    writeRepoFile(`${SCOPE}/src/app.ts`, "export const nativeType = 'int4';\n");
    writeRepoFile(`examples/app/${SCOPE}/src/app.ts`, "export const nativeType = 'int4';\n");

    const result = runList(1);
    assert.equal(result.status, 0, `expected exit 0; stdout=${result.stdout}`);
    assert.match(result.stdout, /count=1 threshold=1/);
    assert.doesNotMatch(result.stdout, /examples\/app/);
  });
});
