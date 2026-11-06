import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMigrationPackage } from '../src/io';
import { writeTestPackage } from './fixtures';

const op = (check: Record<string, unknown>) => ({
  id: 'table.users',
  label: 'Create table users',
  operationClass: 'additive' as const,
  precheck: [{ description: 'ensure table "users" does not exist', ...check }],
});

describe('reading an ops.json whose check says what it is about', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'migration-check-shape-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function read(check: Record<string, unknown>) {
    const dir = join(tmpDir, '20260225T1430_add_users');
    await writeTestPackage(dir);
    await writeFile(join(dir, 'ops.json'), JSON.stringify([op(check)]));
    return readMigrationPackage(dir, { migrationsDir: tmpDir });
  }

  it.each([
    [
      'an expectation of another shape',
      { expectation: { expects: 'gone', object: 'table "users"' } },
    ],
    ['an expectation without its object', { expectation: { expects: 'absent' } }],
    ['an empty object name', { object: '' }],
    ['an object name that is not text', { object: 7 }],
  ])('refuses %s, naming the migration', async (_name, check) => {
    await expect(read(check)).rejects.toMatchObject({
      code: 'MIGRATION.INVALID_MANIFEST',
      meta: { filePath: join(tmpDir, '20260225T1430_add_users', 'ops.json') },
    });
  });

  it('reads a check whose expectation or object has the right shape', async () => {
    const dir = join(tmpDir, '20260225T1430_add_users');
    const ops = [
      op({ expectation: { expects: 'absent', object: 'table "users"' } }),
      op({ object: 'collection "users"' }),
    ];
    await writeTestPackage(dir, {}, ops);

    expect((await readMigrationPackage(dir, { migrationsDir: tmpDir })).ops).toEqual(ops);
  });
});
