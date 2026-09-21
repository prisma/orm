import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  cleanupProjectDirs,
  diagnosticsOf,
  envelopeOf,
  HASH_A,
  HASH_PREVIOUS,
  harness,
  MASKED_CONNECTION,
  MISSING_COLUMN,
  mocks,
  ormConfig,
  projectDir,
  resetMocks,
  schemaResult,
  signResult,
} from './db-sign-fixtures';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

describe('db sign', () => {
  describe('verification passes', () => {
    it('signs and completes at exit 0 with no diagnostics', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(diagnosticsOf(run)).toEqual([]);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      expect(run.presented?.data).toEqual({
        ...signResult(),
        advancedRef: { name: 'db', hash: HASH_A },
      });
    });

    it('reads the contract through the family seam rather than a bare JSON.parse', async () => {
      const dir = await projectDir();

      await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(mocks.schemaVerify).toHaveBeenCalledWith(
        expect.objectContaining({
          contract: expect.objectContaining({ hydrated: true }),
          strict: false,
        }),
      );
    });

    it('heads the human output with the contract and the masked database', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human).toEqual([
        {
          kind: 'fields',
          rail: true,
          rows: [
            { label: 'contract', value: 'output/contract.json' },
            { label: 'database', value: MASKED_CONNECTION },
          ],
        },
        { kind: 'summary', status: 'ok', text: 'Database signed' },
        {
          kind: 'fields',
          rows: [
            { label: 'from', value: [{ text: HASH_PREVIOUS, tone: 'identifier' }] },
            { label: 'to', value: [{ text: HASH_A, tone: 'identifier' }] },
          ],
        },
        {
          kind: 'summary',
          status: 'ok',
          text: [{ text: 'Advanced ref "db" → ' }, { text: HASH_A, tone: 'identifier' }],
        },
      ]);
      expect(run.presented?.presentation.stdout).toEqual([]);
      expect(run.stdout).toBe('');
    });
  });

  describe('the family reports it did not sign', () => {
    it('reaches the engine as an internal error rather than claiming success', async () => {
      const dir = await projectDir();
      mocks.sign.mockResolvedValue({ ...signResult(), ok: false, summary: 'Marker not written' });

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(1);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.INTERNAL_ERROR' } });
    });

    it('does not present "Database signed"', async () => {
      const dir = await projectDir();
      mocks.sign.mockResolvedValue({ ...signResult(), ok: false, summary: 'Marker not written' });

      const run = await harness(ormConfig()).run(['db', 'sign'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.stderr).not.toContain('Database signed');
    });
  });

  describe('verification fails', () => {
    const DRIFTED = schemaResult({
      ok: false,
      code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
      summary: 'Database schema does not satisfy contract',
      schema: { issues: [MISSING_COLUMN] },
    });

    it('completes at exit 4 without writing a signature', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockResolvedValue(DRIFTED);

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
    });

    it('carries the verdict as one error diagnostic', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockResolvedValue(DRIFTED);

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(
        diagnosticsOf(run).map((entry) => ({
          code: entry.code,
          severity: entry.severity,
          summary: entry.summary,
        })),
      ).toEqual([
        {
          code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
          severity: 'error',
          summary: 'Database schema does not satisfy contract',
        },
      ]);
      expect(diagnosticsOf(run)[0]?.nextActions).toEqual([
        {
          kind: 'run-command',
          label: 'Bring the database up to the contract, then sign again',
          command: '{bin} db update',
        },
      ]);
    });

    it('reports the schema-verify document as the --json payload', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockResolvedValue(DRIFTED);

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.presented?.data).toEqual(DRIFTED);
      expect(run.presented?.data).not.toHaveProperty('unclaimed');
    });

    it('draws the drift as a tree and closes with the failing summary', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockResolvedValue(DRIFTED);

      const run = await harness(ormConfig()).run(['db', 'sign'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human[1]).toEqual({
        kind: 'tree',
        roots: [
          {
            label: 'Schema issues',
            status: 'error',
            children: [{ label: 'missing: public/users/email', status: 'error' }],
          },
        ],
      });
      expect(run.presented?.presentation.human.at(-1)).toEqual({
        kind: 'summary',
        status: 'error',
        text: 'Database schema does not satisfy contract',
      });
    });
  });

  describe('could not sign', () => {
    it('errors at exit 2 when the contract is named twice', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'sign', 'production', '--contract', 'staging', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.CONTRACT_ARG_CONFLICT' },
      });
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
    });

    it('errors at exit 2 when the contract has not been emitted', async () => {
      const dir = await projectDir({ contract: false });

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } });
    });

    it('errors at exit 2 when no connection is configured', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig({ db: undefined })).run(['db', 'sign', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
      });
    });

    it('errors at exit 2 when no driver is configured', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig({ driver: undefined })).run(['db', 'sign', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONFIG.DRIVER_REQUIRED' },
      });
    });

    it('errors at exit 2 when the named contract reference resolves against nothing', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', 'production', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.REF_NOT_FOUND' },
      });
      expect(mocks.schemaVerify).not.toHaveBeenCalled();
    });

    it('errors at exit 2 when the driver throws, without leaking the connection string', async () => {
      const dir = await projectDir();
      mocks.schemaVerify.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.UNEXPECTED' } });
      expect(JSON.stringify(run.json.at(-1))).not.toContain('secret');
      expect(mocks.close).toHaveBeenCalled();
    });
  });

  it('spells its exit codes in --help, which does not render the exitCodes map', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--help'], { cwd: dir });

    expect(`${run.stdout}${run.stderr}`).toContain('4 = schema verification failed');
  });

  it('does not turn a written signature into a failure when the hang-up fails', async () => {
    const dir = await projectDir();
    mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(envelopeOf(run)?.ok).toBe(true);
  });
});
