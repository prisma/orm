import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/default-generators-to-on-create/rewrite-default-generators.mjs',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/default-generators-to-on-create/rewrite-default-generators.mjs',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixturesDir = join(here, 'fixtures');
const script = join(repoRoot, SCRIPT_PATHS.app);
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyBefore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'default-generators-to-on-create-'));
  workDirs.push(dir);
  cpSync(join(fixturesDir, 'before'), dir, { recursive: true });
  return dir;
}

function filesOf(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
}

function run(dir: string, files: readonly string[]) {
  const result = spawnSync(process.execPath, [script, ...files], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('rewrite-default-generators', () => {
  it('rewrites every client function in @default of a Prisma 8 file to @onCreate, keeping each call as written and leaving comments and every other file unchanged', () => {
    const dir = copyBefore();
    const files = [
      'schema.prisma',
      'older-header.prisma',
      'unchanged.prisma',
      'prisma7.prisma',
      'prisma7-models.prisma',
    ];
    const result = run(dir, files);
    const written = filesOf(dir);
    const after = filesOf(join(fixturesDir, 'after'));
    expect({
      status: result.status,
      stdout: result.stdout,
      files: files.map((name) => written[name]),
    }).toEqual({
      status: 0,
      stdout: [
        'schema.prisma: rewrote 9 @default calls to @onCreate.',
        'older-header.prisma: rewrote 1 @default call to @onCreate.',
        'unchanged.prisma: no client function in @default; left unchanged.',
        'prisma7.prisma: has no "// use prisma-8" directive, so it is not a Prisma 8 schema; left unchanged. A Prisma 7 schema keeps @default(uuid()).',
        'prisma7-models.prisma: has no "// use prisma-8" directive, so it is not a Prisma 8 schema; left unchanged. A Prisma 7 schema keeps @default(uuid()).',
        '',
      ].join('\n'),
      files: files.map((name) => after[name]),
    });
  });

  it('reads the Prisma 8 header as contract emit does', () => {
    const dir = copyBefore();
    const files = [
      'blank-line-header.prisma',
      'no-space-header.prisma',
      'bom-header.prisma',
      'trailing-text-header.prisma',
    ];
    const result = run(dir, files);
    const after = filesOf(join(fixturesDir, 'after'));
    const written = filesOf(dir);
    expect({
      status: result.status,
      stdout: result.stdout,
      files: files.map((name) => written[name]),
    }).toEqual({
      status: 0,
      stdout: `${files.map((name) => `${name}: rewrote 1 @default call to @onCreate.`).join('\n')}\n`,
      files: files.map((name) => after[name]),
    });
  });

  it('skips exactly the files without the Prisma 8 directive', () => {
    const dir = copyBefore();
    const files = Object.keys(filesOf(dir)).sort();
    const skipped = run(dir, files)
      .stdout.split('\n')
      .filter((line) => line.includes('is not a Prisma 8 schema'))
      .map((line) => line.slice(0, line.indexOf(':')));
    expect(skipped).toEqual(['prisma7-models.prisma', 'prisma7.prisma']);
  });

  it('is idempotent', () => {
    const dir = copyBefore();
    run(dir, ['schema.prisma']);
    const result = run(dir, ['schema.prisma']);
    expect({ status: result.status, schema: filesOf(dir)['schema.prisma'] }).toEqual({
      status: 0,
      schema: filesOf(join(fixturesDir, 'after'))['schema.prisma'],
    });
  });

  it('refuses to run without files and names a file it cannot read', () => {
    const dir = copyBefore();
    expect({ none: run(dir, []).status, missing: run(dir, ['missing.prisma']) }).toEqual({
      none: 1,
      missing: {
        status: 1,
        stdout: '',
        stderr: 'missing.prisma: cannot be read; no file was changed.\n',
      },
    });
  });

  it('ships the same script for extensions', () => {
    expect(readFileSync(join(repoRoot, SCRIPT_PATHS.extension), 'utf8')).toBe(
      readFileSync(script, 'utf8'),
    );
  });
});
