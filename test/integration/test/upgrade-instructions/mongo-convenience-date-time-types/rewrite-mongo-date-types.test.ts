import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.23-to-8.0.0-rc.24/scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.23-to-8.0.0-rc.24/scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts',
} as const;

const EXPECTED_STDOUT = [
  "bookings/schema/booking.prisma: line 6: Date names the Date declared in bookings/schema/date.prisma line 1, not MongoDB's date; the script leaves this schema as it is.",
  'migrations/app/20260101T0000_initial/contract.prisma: rewrote 6 field types.',
  'psl-glob/schema/nested/stays.psl: rewrote 1 field type.',
  'psl/schema.psl: rewrote 1 field type.',
  'src/contract.prisma: rewrote 6 field types.',
  'src/contract.ts: rewrote 2 type.Date() calls.',
  'src/namespaced.ts: rewrote 1 type.Date() call.',
  'src/published.ts: rewrote 1 type.Date() call.',
  'src/unknown.ts: line 4: types.Date(): the script cannot tell this is the type of a MongoDB contract builder; if it is, write DateTime.',
  'Changed 7 files.',
  '',
].join('\n');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixturesDir = join(here, 'fixtures');
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyBefore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mongo-convenience-date-time-types-'));
  workDirs.push(dir);
  cpSync(join(fixturesDir, 'before'), dir, { recursive: true });
  return dir;
}

function filesOf(dir: string, under = dir): Record<string, string> {
  return Object.fromEntries(
    readdirSync(under).flatMap((name) => {
      const path = join(under, name);
      return statSync(path).isDirectory()
        ? Object.entries(filesOf(dir, path))
        : [[relative(dir, path), readFileSync(path, 'utf8')]];
    }),
  );
}

function run(script: string, dir: string, args: readonly string[] = []) {
  const result = spawnSync(process.execPath, [join(repoRoot, script), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.each(Object.entries(SCRIPT_PATHS))(
  'the %s rewrite-mongo-date-types script',
  (_, script) => {
    it('rewrites Date to DateTime in MongoDB schemas and contracts, and leaves SQL and Prisma 6 schemas alone', () => {
      const dir = copyBefore();
      const result = run(script, dir);
      expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toEqual({
        status: 0,
        stderr: '',
        stdout: EXPECTED_STDOUT,
      });
      expect(filesOf(dir)).toEqual(filesOf(join(fixturesDir, 'after')));
    });

    it('rewrites only the files it is given', () => {
      const dir = copyBefore();
      const result = run(script, dir, ['src/contract.prisma', 'sql']);
      expect({
        stdout: result.stdout,
        snapshot: readFileSync(
          join(dir, 'migrations/app/20260101T0000_initial/contract.prisma'),
          'utf8',
        ),
      }).toEqual({
        stdout: 'src/contract.prisma: rewrote 6 field types.\nChanged 1 file.\n',
        snapshot: readFileSync(
          join(fixturesDir, 'before/migrations/app/20260101T0000_initial/contract.prisma'),
          'utf8',
        ),
      });
    });

    it('leaves a schema whose other file declares Date when it is given only the file that uses Date', () => {
      const dir = copyBefore();
      const result = run(script, dir, ['bookings/schema/booking.prisma']);
      expect({
        stdout: result.stdout,
        booking: readFileSync(join(dir, 'bookings/schema/booking.prisma'), 'utf8'),
      }).toEqual({
        stdout: `${EXPECTED_STDOUT.split('\n')[0]}\nChanged 0 files.\n`,
        booking: readFileSync(join(fixturesDir, 'before/bookings/schema/booking.prisma'), 'utf8'),
      });
    });

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      expect({ stdout: run(script, dir).stdout, files: filesOf(dir) }).toEqual({
        stdout: [
          EXPECTED_STDOUT.split('\n').find((line) => line.startsWith('bookings/')),
          EXPECTED_STDOUT.split('\n').find((line) => line.startsWith('src/unknown.ts')),
          'Changed 0 files.',
          '',
        ].join('\n'),
        files: filesOf(join(fixturesDir, 'after')),
      });
    });
  },
);
