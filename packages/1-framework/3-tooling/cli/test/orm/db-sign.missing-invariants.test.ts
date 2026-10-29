import { ok } from '@internal/utils/result';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbSignSpaceOutcome } from '../../src/control-api/operations/db-sign';
import { issueNodes } from '../../src/orm/db/verification';
import {
  cleanupProjectDirs,
  DRIFTED,
  diagnosticsOf,
  envelopeOf,
  HASH_A,
  HASH_EXT,
  HASH_PREVIOUS,
  harness,
  MISSING_COLUMN,
  mocks,
  ormConfig,
  PROFILE_HASH,
  projectDir,
  refHashOf,
  resetMocks,
  signedSpace,
} from './db-sign-fixtures';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

const INSTALL_VECTOR = 'pgvector:install-vector-v1';

const refused: DbSignSpaceOutcome = {
  space: 'pgvector',
  status: 'missing-invariants',
  contract: { storageHash: HASH_EXT, profileHash: PROFILE_HASH },
  missingInvariants: [INSTALL_VECTOR],
};

const signed = signedSpace('app', HASH_A);

describe('db sign refusing a space whose marker lacks a required invariant', () => {
  beforeEach(() => {
    mocks.dbSign.mockResolvedValue(ok({ spaces: [signed, refused] }));
  });

  it('completes at exit 4, signs the other space and advances only its ref', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(4);
    expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
    expect(run.presented?.data).toEqual({
      ok: false,
      summary: 'Space "pgvector" requires invariants its marker does not record; signed "app"',
      spaces: [signed, refused],
      advancedRefs: [{ space: 'app', name: 'db', hash: HASH_A }],
    });
    expect(await refHashOf(dir, 'db', 'pgvector')).toBeUndefined();
  });

  it('names the space and each missing invariant, and says to run db migrate', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(diagnosticsOf(run)).toEqual([
      {
        code: 'MIGRATION.SIGN_INVARIANTS_MISSING',
        severity: 'error',
        summary: 'Space "pgvector" requires invariants its marker does not record',
        why: `The head ref of space "pgvector" requires the invariant "${INSTALL_VECTOR}", which the database marker does not record. An invariant records that a migration ran, and db sign never runs migrations, so it did not sign this space.`,
        nextActions: [
          {
            kind: 'run-command',
            label: 'Run the migrations that provide the invariants, then sign again',
            command: 'prisma-test db migrate',
          },
        ],
        meta: { space: 'pgvector', missingInvariants: [INSTALL_VECTOR] },
      },
    ]);
  });

  it('prints each space with its status', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign'], { cwd: dir });

    expect(run.stdout).toBe(`app\tupdated\t${HASH_A}\npgvector\tmissing-invariants\t${HASH_EXT}\n`);
  });

  it('draws the missing invariants under the refused space', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[1]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: [
            { text: 'app: signed ' },
            { text: HASH_A, tone: 'identifier' },
            { text: ' (was ', tone: 'muted' },
            { text: HASH_PREVIOUS, tone: 'identifier' },
            { text: ')', tone: 'muted' },
          ],
          status: 'ok',
        },
        {
          label:
            'pgvector: not signed, its marker does not record invariants its head ref requires',
          status: 'error',
          children: [{ label: `missing invariant: ${INSTALL_VECTOR}`, status: 'error' }],
        },
      ],
    });
  });

  it('spells the refusal in --help', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--help'], { cwd: dir });

    expect(`${run.stdout}${run.stderr}`).toContain('invariants its marker does not record');
  });
});

describe('db sign refusing a space that also fails verification', () => {
  const refusedAndDrifted: DbSignSpaceOutcome = { ...refused, schema: DRIFTED };

  beforeEach(() => {
    mocks.dbSign.mockResolvedValue(ok({ spaces: [signed, refusedAndDrifted] }));
  });

  it('reports the missing invariants and the schema verdict', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(4);
    expect(diagnosticsOf(run).map((diagnostic) => diagnostic.code)).toEqual([
      'MIGRATION.SIGN_INVARIANTS_MISSING',
      'CONTRACT.SCHEMA_VERIFICATION_FAILED',
    ]);
    expect(run.presented?.data).toMatchObject({
      summary:
        'Space "pgvector" requires invariants its marker does not record; Database schema does not satisfy contract for space "pgvector"; signed "app"',
    });
  });

  it('draws the schema issues under the missing invariants', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
      cwd: dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[1]).toMatchObject({
      kind: 'tree',
      roots: [
        { status: 'ok' },
        {
          label:
            'pgvector: not signed, its marker does not record invariants its head ref requires, and the schema does not satisfy its contract',
          status: 'error',
          children: [
            { label: `missing invariant: ${INSTALL_VECTOR}`, status: 'error' },
            ...issueNodes([MISSING_COLUMN], 'error'),
          ],
        },
      ],
    });
  });
});
