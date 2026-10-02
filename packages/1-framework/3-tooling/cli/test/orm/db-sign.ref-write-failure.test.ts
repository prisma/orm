import { chmod, mkdir } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { ok } from '@internal/utils/result';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupProjectDirs,
  conflictSpace,
  envelopeOf,
  failedSpace,
  HASH_A,
  HASH_EXT,
  harness,
  mocks,
  ormConfig,
  projectDir,
  refHashOf,
  refsDirOf,
  resetMocks,
  signedSpace,
} from './db-sign-fixtures';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

/** Makes the app space's refs directory read-only for the duration of `run`. */
async function withReadOnlyAppRefs<T>(dir: string, run: () => Promise<T>): Promise<T> {
  await mkdir(refsDirOf(dir), { recursive: true });
  await chmod(refsDirOf(dir), 0o555);
  try {
    return await run();
  } finally {
    await chmod(refsDirOf(dir), 0o755);
  }
}

function settledError(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result') {
    throw new Error('the run did not settle');
  }
  const envelope = Reflect.get(terminal, 'envelope');
  return Reflect.get(Object(envelope), 'error');
}

describe('db sign when a ref cannot be written after the markers are written', () => {
  beforeEach(() => {
    mocks.dbSign.mockResolvedValue(
      ok({ spaces: [signedSpace('app', HASH_A), signedSpace('pgvector', HASH_EXT)] }),
    );
  });

  it('says the database was signed, names the ref it could not write, and writes the other refs', async () => {
    const dir = await projectDir();

    const run = await withReadOnlyAppRefs(dir, () =>
      harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir }),
    );

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.SIGN_REFS_NOT_WRITTEN' },
    });
    expect(settledError(run)).toMatchObject({
      summary: 'Database signed, but 1 ref was not written',
      why: expect.stringMatching(
        /^The database was signed: the markers of spaces "app", "pgvector" hold their contracts\. These refs were not written: ref "db" of space "app" \(.*EACCES.*\)\.$/,
      ),
      nextActions: [
        {
          kind: 'run-command',
          label: 'Sign again to write the refs that were not written',
          command: 'prisma-test db sign',
        },
      ],
      meta: {
        signedSpaces: ['app', 'pgvector'],
        failedSpaces: [],
        conflictSpaces: [],
        unwrittenRefs: [{ space: 'app', name: 'db', hash: HASH_A }],
        advancedRefs: [{ space: 'pgvector', name: 'db', hash: HASH_EXT }],
      },
    });
    expect(await refHashOf(dir, 'db', 'pgvector')).toBe(HASH_EXT);
    expect(await refHashOf(dir, 'db')).toBeUndefined();
  });

  it('repeats the contract and ref arguments in the command that finishes the job', async () => {
    const dir = await projectDir();
    await writeRef(refsDirOf(dir), 'staging', { hash: HASH_A, invariants: [] });

    const run = await withReadOnlyAppRefs(dir, () =>
      harness(ormConfig()).run(
        ['db', 'sign', '--contract', 'staging', '--advance-ref', 'production', '--json'],
        { cwd: dir },
      ),
    );

    expect(run.exitCode).toBe(2);
    expect(settledError(run)).toMatchObject({
      nextActions: [
        {
          kind: 'run-command',
          command: 'prisma-test db sign --contract "staging" --advance-ref production',
        },
      ],
    });
  });

  it('also names the spaces it did not sign', async () => {
    mocks.dbSign.mockResolvedValue(
      ok({
        spaces: [
          signedSpace('app', HASH_A),
          failedSpace('pgvector', HASH_EXT),
          conflictSpace('audit', HASH_EXT),
        ],
      }),
    );
    const dir = await projectDir();

    const run = await withReadOnlyAppRefs(dir, () =>
      harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir }),
    );

    expect(run.exitCode).toBe(2);
    expect(settledError(run)).toMatchObject({
      why: expect.stringMatching(
        /^The database was signed: the marker of space "app" holds its contract\. Space "pgvector" was not signed, because its schema does not satisfy its contract\. Space "audit" was not signed, because its marker changed while db sign ran\. These refs were not written: ref "db" of space "app" \(.*EACCES.*\)\.$/,
      ),
      meta: {
        signedSpaces: ['app'],
        failedSpaces: ['pgvector'],
        conflictSpaces: ['audit'],
        unwrittenRefs: [{ space: 'app', name: 'db', hash: HASH_A }],
        advancedRefs: [],
      },
    });
  });
});
