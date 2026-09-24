import { mkdir, rm, writeFile } from 'node:fs/promises';
import type {
  SchemaDiffIssue,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok } from '@internal/utils/result';
import type { MountedTree, PresentedResult } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createDbVerifyCommand } from '../../src/orm/db/verify';
import { CliStructuredError } from '../../src/utils/cli-errors';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;
const HASH_B = `9d0f118${'2'.repeat(57)}`;
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';
const MASKED_CONNECTION = 'postgres://****:****@localhost:5432/appdb';

const mocks = {
  connect: vi.fn(),
  close: vi.fn(),
  verify: vi.fn(),
  dbVerify: vi.fn(),
};

/**
 * The command is mounted over a fake control client instead of the module
 * being mocked: `createDbVerifyCommand` takes the client factory as its seam.
 */
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'db verify': createDbVerifyCommand(() =>
    blindCast<ControlClient, 'the fake implements only what db verify touches'>({
      connect: mocks.connect,
      verify: mocks.verify,
      dbVerify: mocks.dbVerify,
      close: mocks.close,
    }),
  ),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

async function projectDir(options: { readonly contract?: boolean } = {}): Promise<string> {
  const dir = createTestProjectDir('orm-db-verify');
  dirs.push(dir);
  if (options.contract !== false) {
    await mkdir(join(dir, 'output'), { recursive: true });
    await writeFile(
      join(dir, 'output', 'contract.json'),
      JSON.stringify({ storage: { storageHash: HASH_A }, target: 'postgres' }),
      'utf-8',
    );
  }
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: CONNECTION },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: 'output/contract.json',
    },
    ...overrides,
  };
}

function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups, orm: config });
}

function verified(overrides: Partial<VerifyDatabaseResult> = {}): VerifyDatabaseResult {
  return {
    ok: true,
    summary: 'Database marker matches contract',
    contract: { storageHash: HASH_A },
    marker: { storageHash: HASH_A },
    target: { expected: 'postgres', actual: 'postgres' },
    timings: { total: 1 },
    ...overrides,
  };
}

const MISSING_COLUMN = blindCast<
  SchemaDiffIssue,
  'The renderer reads the path and which side is present'
>({ path: ['public', 'users', 'email'], expected: { id: 'email', nodeKind: 'column' } });

function schemaResult(
  overrides: Partial<VerifyDatabaseSchemaResult> = {},
): VerifyDatabaseSchemaResult {
  return {
    ok: true,
    summary: 'Database schema satisfies contract',
    contract: { storageHash: HASH_A },
    target: { expected: 'postgres' },
    schema: { issues: [] },
    meta: { strict: false },
    timings: { total: 1 },
    ...overrides,
  };
}

function aggregateOk(inputs: {
  readonly perSpace?: ReadonlyArray<readonly [string, VerifyDatabaseSchemaResult]>;
  readonly unclaimed?: readonly string[];
  readonly markerDrift?: CliStructuredError;
}) {
  return ok({
    schemaResults: new Map(inputs.perSpace ?? [['app', schemaResult()]]),
    unclaimed: inputs.unclaimed ?? [],
    spaceOrder: ['app'],
    appSpaceId: 'app',
    markerDrift: inputs.markerDrift ?? null,
  });
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.verify.mockReset().mockResolvedValue(verified());
  mocks.dbVerify.mockReset().mockResolvedValue(aggregateOk({}));
});

function diagnosticsOf(run: {
  readonly presented: PresentedResult<unknown> | undefined;
}): readonly Diagnostic[] {
  return run.presented?.diagnostics ?? [];
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? blindCast<{ ok: boolean; error?: { code: string }; exitCode?: number }, 'terminal frame'>(
        Reflect.get(terminal, 'envelope'),
      )
    : undefined;
}

describe('db verify', () => {
  describe('the database matches the contract', () => {
    it('completes at exit 0 with no diagnostics', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(diagnosticsOf(run)).toEqual([]);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        mode: 'full',
        summary: 'Database marker and schema match contract',
        unclaimed: [],
      });
    });

    it('heads the human output with the contract, the mode and the masked database', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'verify'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human[0]).toEqual({
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: 'output/contract.json' },
          { label: 'mode', value: 'full (marker + schema, tolerant)' },
          { label: 'database', value: MASKED_CONNECTION },
        ],
      });
      expect(run.presented?.presentation.human[1]).toEqual({
        kind: 'summary',
        status: 'ok',
        text: 'Database marker and schema match contract',
      });
      expect(run.presented?.presentation.stdout).toEqual([]);
      expect(run.stdout).toBe('');
    });

    it('says the schema check was skipped under --marker-only', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'verify', '--marker-only', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        ok: true,
        mode: 'marker-only',
        warning: 'Schema verification skipped because --marker-only was provided',
        meta: { schemaVerification: 'skipped' },
      });
      expect(run.presented?.data).not.toHaveProperty('unclaimed');
    });

    it('takes the connection from --db over the config', async () => {
      const dir = await projectDir();

      await harness(ormConfig()).run(['db', 'verify', '--db', 'postgres://other/db', '--json'], {
        cwd: dir,
      });

      expect(mocks.verify).toHaveBeenCalledWith(
        expect.objectContaining({ connection: 'postgres://other/db' }),
      );
    });
  });

  describe('marker findings', () => {
    it('completes at exit 4 carrying the missing-marker code at error severity', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(
        diagnosticsOf(run).map((entry) => ({ code: entry.code, severity: entry.severity })),
      ).toEqual([{ code: 'CONTRACT.MARKER_MISSING', severity: 'error' }]);
      expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
    });

    it('reports a hash mismatch under its own code', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({
          ok: false,
          code: 'CONTRACT.MARKER_MISMATCH',
          summary: 'Marker does not match',
          marker: { storageHash: HASH_B },
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual(['CONTRACT.MARKER_MISMATCH']);
    });

    it('reports a target mismatch under its own code', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({
          ok: false,
          code: 'CONTRACT.TARGET_MISMATCH',
          summary: 'Target does not match',
          target: { expected: 'postgres', actual: 'mysql' },
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual(['CONTRACT.TARGET_MISMATCH']);
    });

    it('reports the verdict as a completed document rather than an error envelope', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.presented?.data).toMatchObject({
        ok: false,
        mode: 'full',
        summary: 'No marker found',
        contract: { storageHash: HASH_A },
      });
      expect(envelopeOf(run)?.ok).toBe(true);
    });

    it('says the schema check was skipped, because the marker verdict returned first', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.presented?.data).toMatchObject({ meta: { schemaVerification: 'skipped' } });
    });

    it('omits unclaimed rather than reporting an empty list nothing looked for', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.presented?.data).not.toHaveProperty('unclaimed');
    });

    it('does not run the aggregate verifier once the marker check has failed', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(mocks.dbVerify).not.toHaveBeenCalled();
    });

    it('gives the finding typed next actions and no fix prose', async () => {
      const dir = await projectDir();
      mocks.verify.mockResolvedValue(
        verified({ ok: false, code: 'CONTRACT.MARKER_MISSING', summary: 'No marker found' }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });
      const [finding] = diagnosticsOf(run);

      expect(finding?.nextActions.length).toBeGreaterThan(0);
      expect(finding).not.toHaveProperty('fix');
    });
  });

  describe('aggregate marker drift', () => {
    const DRIFT = new CliStructuredError(
      'MIGRATION.CONTRACT_SPACE_VIOLATION',
      'Contract-space verifier found a violation',
      {
        why: 'The on-disk `migrations/` directory, the `extensions` declaration, and the live database marker rows are not in agreement.\n- [hashMismatch] audit: Apply on-disk migrations under `migrations/audit/` to advance the marker, or remove the conflicting marker row.',
        meta: { violations: [{ kind: 'hashMismatch', spaceId: 'audit' }] },
      },
    );

    it('completes at exit 4 carrying the violation as an error diagnostic', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ markerDrift: DRIFT }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
      expect(
        diagnosticsOf(run).map((entry) => ({
          code: entry.code,
          severity: entry.severity,
          summary: entry.summary,
        })),
      ).toEqual([
        {
          code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
          severity: 'error',
          summary: 'Contract-space verifier found a violation',
        },
      ]);
      expect(run.presented?.data).toMatchObject({
        ok: false,
        mode: 'full',
        summary: 'Contract-space verifier found a violation',
        schema: { summary: 'Database schema satisfies contract', strict: false, warnings: [] },
        unclaimed: [],
        meta: { schemaVerification: 'performed' },
      });
    });

    it('settles --marker-only drift at exit 4 too', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ markerDrift: DRIFT }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--marker-only', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual([
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
      ]);
      expect(run.presented?.data).toMatchObject({
        ok: false,
        mode: 'marker-only',
        meta: { schemaVerification: 'skipped' },
      });
      expect(run.presented?.data).not.toHaveProperty('schema');
      expect(run.presented?.data).not.toHaveProperty('unclaimed');
    });

    it('carries the schema drift diagnostics alongside the violation in full mode', async () => {
      const dir = await projectDir();
      const drifted = schemaResult({
        ok: false,
        code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        summary: 'Database schema does not satisfy contract',
        schema: { issues: [MISSING_COLUMN] },
      });
      mocks.dbVerify.mockResolvedValue(
        aggregateOk({ perSpace: [['app', drifted]], markerDrift: DRIFT }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual([
        'MIGRATION.CONTRACT_SPACE_VIOLATION',
        'CONTRACT.SCHEMA_VERIFICATION_FAILED',
      ]);
      expect(run.presented?.data).toMatchObject({
        ok: false,
        schema: { summary: 'Database schema does not satisfy contract' },
        meta: { schemaVerification: 'performed' },
      });
    });
  });

  describe('schema drift', () => {
    const DRIFTED = schemaResult({
      ok: false,
      code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
      summary: 'Database schema does not satisfy contract',
      schema: { issues: [MISSING_COLUMN] },
    });

    it('completes at exit 4 carrying the failing space under its own code', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [['app', DRIFTED]] }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(
        diagnosticsOf(run).map((entry) => ({
          code: entry.code,
          severity: entry.severity,
          meta: entry.meta,
        })),
      ).toEqual([
        {
          code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
          severity: 'error',
          meta: { space: 'app', issues: ['missing: public/users/email'] },
        },
      ]);
    });

    it('draws the drift as a tree the engine paints', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [['app', DRIFTED]] }));

      const run = await harness(ormConfig()).run(['db', 'verify'], {
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
      expect(JSON.stringify(run.presented?.presentation.human)).not.toContain('\\u001b');
    });

    it('keeps the schema-verify document as the --json payload', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [['app', DRIFTED]] }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.presented?.data).toMatchObject({
        ok: false,
        code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        summary: 'Database schema does not satisfy contract',
        unclaimed: [],
      });
    });

    it('settles --schema-only drift the same way', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [['app', DRIFTED]] }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--schema-only', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.dbVerify).toHaveBeenCalledWith(expect.objectContaining({ skipMarker: true }));
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual([
        'CONTRACT.SCHEMA_VERIFICATION_FAILED',
      ]);
    });

    it('fails on unclaimed elements in strict mode, under the synthesized code', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ unclaimed: ['public/audit_log'] }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--strict', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run).map((entry) => entry.code)).toEqual(['CONTRACT.MARKER_REQUIRED']);
    });

    it('carries unclaimed elements informationally on a passing lenient run', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ unclaimed: ['public/audit_log'] }));

      const run = await harness(ormConfig()).run(['db', 'verify'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.presentation.human.at(-1)).toEqual({
        kind: 'tree',
        roots: [
          {
            label: 'Unclaimed elements (declared by no contract)',
            status: 'warn',
            children: [{ label: 'public/audit_log', status: 'warn' }],
          },
        ],
      });
    });
  });

  describe('could not verify', () => {
    it('refuses --marker-only with --schema-only at exit 2', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'verify', '--marker-only', '--schema-only', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INVALID_VERIFY_MODE' },
      });
    });

    it('refuses --marker-only with --strict at exit 2', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(
        ['db', 'verify', '--marker-only', '--strict', '--json'],
        { cwd: dir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INVALID_VERIFY_MODE' },
      });
    });

    it('errors at exit 2 when the contract has not been emitted', async () => {
      const dir = await projectDir({ contract: false });

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } });
      expect(diagnosticsOf(run)).toEqual([]);
    });

    it('errors at exit 2 when no connection is configured', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig({ db: undefined })).run(['db', 'verify', '--json'], {
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

      const run = await harness(ormConfig({ driver: undefined })).run(['db', 'verify', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONFIG.DRIVER_REQUIRED' },
      });
    });

    it('errors at exit 2 when the aggregate verifier refuses to run', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(
        notOk(
          new CliStructuredError(
            'MIGRATION.CONTRACT_SPACE_VIOLATION',
            'Contract-space verifier found a violation',
            { why: 'The marker rows and the on-disk migrations disagree.' },
          ),
        ),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'MIGRATION.CONTRACT_SPACE_VIOLATION' },
      });
    });

    it('errors at exit 2 when the driver throws, without leaking the connection string', async () => {
      const dir = await projectDir();
      mocks.verify.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.UNEXPECTED' } });
      expect(settled).not.toContain('secret');
      expect(mocks.close).toHaveBeenCalled();
    });

    it('strips the connection string from a driver error that carries an errno code', async () => {
      const dir = await projectDir();
      mocks.verify.mockRejectedValue(
        Object.assign(new Error(`connect ECONNREFUSED for ${CONNECTION}`), {
          code: 'ECONNREFUSED',
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).not.toContain('secret');
      expect(settled).toContain(MASKED_CONNECTION);
    });

    it('strips the connection string from a driver error that carries a SQLSTATE', async () => {
      const dir = await projectDir();
      mocks.verify.mockRejectedValue(
        Object.assign(new Error(`password authentication failed for ${CONNECTION}`), {
          code: '28P01',
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(JSON.stringify(run.json.at(-1))).not.toContain('secret');
    });

    it('strips the connection string from the error meta and next actions', async () => {
      const dir = await projectDir();
      mocks.verify.mockRejectedValue(
        new CliStructuredError('CONTRACT.MARKER_READ_FAILED', `Could not reach ${CONNECTION}`, {
          why: 'The driver refused the connection',
          nextActions: [
            {
              kind: 'run-command',
              label: `Check that ${CONNECTION} is reachable`,
              command: `psql ${CONNECTION}`,
            },
          ],
          meta: { connection: CONNECTION, attempts: 2, urls: [CONNECTION] },
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(settled).not.toContain('secret');
      expect(settled).toContain(MASKED_CONNECTION);
    });

    it('keeps the connection string out of a structured driver error too', async () => {
      const dir = await projectDir();
      mocks.verify.mockRejectedValue(
        new CliStructuredError('CONTRACT.MARKER_READ_FAILED', `Could not reach ${CONNECTION}`, {
          why: `The driver refused ${CONNECTION}`,
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.MARKER_READ_FAILED' },
      });
      expect(JSON.stringify(run.json.at(-1))).not.toContain('secret');
    });
  });

  describe('a wiring bug', () => {
    it('reaches the engine as an internal error at exit 1', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [] }));

      const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(1);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.INTERNAL_ERROR' } });
    });

    it('still hangs up on the client', async () => {
      const dir = await projectDir();
      mocks.dbVerify.mockResolvedValue(aggregateOk({ perSpace: [] }));

      await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

      expect(mocks.close).toHaveBeenCalled();
    });
  });

  it('spells its exit codes in --help, which does not render the exitCodes map', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'verify', '--help'], { cwd: dir });

    expect(`${run.stdout}${run.stderr}`).toContain('4 = drift or a marker finding');
  });

  it('does not turn a completed verification into a failure when the hang-up fails', async () => {
    const dir = await projectDir();
    mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

    const run = await harness(ormConfig()).run(['db', 'verify', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(0);
    expect(envelopeOf(run)?.ok).toBe(true);
  });
});
