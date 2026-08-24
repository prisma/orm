import { existsSync } from 'node:fs';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupRefProjects,
  HASH_A,
  harness,
  refPointerPath,
  refsDirIn,
  seedRefProject,
} from './ref-fixtures';

afterEach(cleanupRefProjects);

describe('ref delete', () => {
  it('removes the pointer and settles as a completed envelope', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'delete', 'staging', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: true, exitCode: 0, result: { ok: true, ref: 'staging', deleted: true } },
    });
    expect(existsSync(refPointerPath(dir, 'staging'))).toBe(false);
  });

  it('removes the ref without asking for consent', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'delete', 'staging'], {
      cwd: dir,
      isTty: { stdin: true, stdout: true },
      answers: [],
    });

    expect(run.exitCode).toBe(0);
    expect(existsSync(refPointerPath(dir, 'staging'))).toBe(false);
  });

  it('renders one summary block naming the deleted ref', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'delete', 'staging'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Deleted ref "' }, { text: 'staging', tone: 'ref' }, { text: '"' }],
      },
    ]);
  });

  it('leaves the contract snapshot the ref pointed at in place', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'staging', { hash: HASH_A, invariants: [] });
    const snapshot = join(contractSnapshotDir(join(dir, 'migrations'), HASH_A), 'contract.json');

    const run = await harness().run(['migration', 'ref', 'delete', 'staging', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(0);
    expect(existsSync(snapshot)).toBe(true);
  });

  it('deletes the db ref without special casing the name', async () => {
    const { dir } = await seedRefProject();
    await writeRef(refsDirIn(dir), 'db', { hash: HASH_A, invariants: [] });

    const run = await harness().run(['migration', 'ref', 'delete', 'db', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(existsSync(refPointerPath(dir, 'db'))).toBe(false);
  });

  it('refuses an unknown ref', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'delete', 'missing', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.UNKNOWN_REF' } },
    });
  });

  it('refuses an invalid ref name', async () => {
    const { dir } = await seedRefProject();

    const run = await harness().run(['migration', 'ref', 'delete', 'bad//name', '--json'], {
      cwd: dir,
    });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.INVALID_REF_NAME' } },
    });
  });
});
