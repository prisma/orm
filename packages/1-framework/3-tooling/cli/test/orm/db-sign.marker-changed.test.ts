import { ok } from '@internal/utils/result';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupProjectDirs,
  conflictSpace,
  diagnosticsOf,
  envelopeOf,
  failedSpace,
  HASH_A,
  HASH_EXT,
  HASH_MOVED,
  HASH_PREVIOUS,
  harness,
  mocks,
  ormConfig,
  projectDir,
  resetMocks,
  signedSpace,
} from './db-sign-fixtures';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

describe('db sign when a marker changes while it runs', () => {
  function appChangedExtensionSigns() {
    mocks.dbSign.mockResolvedValue(
      ok({ spaces: [conflictSpace('app', HASH_A), signedSpace('pgvector', HASH_EXT)] }),
    );
  }

  it('completes at exit 4, signs the other spaces and advances only their refs', async () => {
    const dir = await projectDir();
    appChangedExtensionSigns();

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(4);
    expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
    expect(run.presented?.data).toEqual({
      ok: false,
      summary: 'Marker of space "app" changed while db sign ran; signed "pgvector"',
      spaces: [conflictSpace('app', HASH_A), signedSpace('pgvector', HASH_EXT)],
      advancedRefs: [{ space: 'pgvector', name: 'db', hash: HASH_EXT }],
    });
  });

  it('names schema failures and changed markers together', async () => {
    const dir = await projectDir();
    mocks.dbSign.mockResolvedValue(
      ok({ spaces: [failedSpace('app', HASH_A), conflictSpace('pgvector', HASH_EXT)] }),
    );

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(4);
    expect(run.presented?.data).toMatchObject({
      summary:
        'Database schema does not satisfy contract for space "app"; marker of space "pgvector" changed while db sign ran; signed nothing',
      advancedRefs: [],
    });
  });

  it('carries an error diagnostic that says what changed and to sign again', async () => {
    const dir = await projectDir();
    appChangedExtensionSigns();

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(diagnosticsOf(run)).toEqual([
      {
        code: 'MIGRATION.MARKER_CAS_FAILURE',
        severity: 'error',
        summary: 'Marker of space "app" changed while db sign ran',
        why: `Another process, such as migrate, changed the marker from ${HASH_PREVIOUS} to ${HASH_MOVED} after db sign read it, so db sign did not sign the space.`,
        nextActions: [
          {
            kind: 'run-command',
            label: 'Sign again once the other process has finished',
            command: 'prisma-test db sign',
          },
        ],
        meta: {
          space: 'app',
          expectedStorageHash: HASH_PREVIOUS,
          foundStorageHash: HASH_MOVED,
          destinationStorageHash: HASH_A,
        },
      },
    ]);
  });

  it('draws the marker it verified and the marker it found under the space', async () => {
    const dir = await projectDir();
    appChangedExtensionSigns();

    const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[1]).toMatchObject({
      kind: 'tree',
      roots: [
        {
          label: 'app: not signed, its marker changed after the schema was verified',
          status: 'error',
          children: [
            { label: `marker when verified: ${HASH_PREVIOUS}`, status: 'error' },
            { label: `marker now: ${HASH_MOVED}`, status: 'error' },
          ],
        },
        { status: 'ok' },
      ],
    });
  });

  it('spells the changed-marker exit code in --help', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--help'], { cwd: dir });

    expect(`${run.stdout}${run.stderr}`).toContain('or its marker changed while db sign ran');
  });
});
