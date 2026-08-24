import { mkdir, rm, writeFile } from 'node:fs/promises';
import type {
  MigrationPlanOperation,
  SchemaDiffIssue,
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { blindCast } from '@internal/utils/casts';
import type { MountedTree, PresentedResult } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createDbSignCommand } from '../../src/orm/db/sign';
import { createTestProjectDir } from '../utils/test-project-dir';

const HASH_A = `4cb4256${'0'.repeat(57)}`;
const HASH_PREVIOUS = `9d0f118${'2'.repeat(57)}`;
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';
const MASKED_CONNECTION = 'postgres://****:****@localhost:5432/appdb';

const mocks = {
  connect: vi.fn(),
  close: vi.fn(),
  schemaVerify: vi.fn(),
  sign: vi.fn(),
};

/**
 * The command is mounted over a fake control client instead of the module
 * being mocked: `createDbSignCommand` takes the client factory as its seam.
 */
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'db sign': createDbSignCommand(() =>
    blindCast<ControlClient, 'the fake implements only what db sign touches'>({
      connect: mocks.connect,
      schemaVerify: mocks.schemaVerify,
      sign: mocks.sign,
      close: mocks.close,
    }),
  ),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

async function projectDir(options: { readonly contract?: boolean } = {}): Promise<string> {
  const dir = createTestProjectDir('orm-db-sign');
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

/**
 * The fake family stamps every contract it hydrates, so a test can tell a
 * value that crossed the `deserializeContract` seam from a bare `JSON.parse`.
 */
function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => ({ ...Object(json), hydrated: true }),
      }),
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
  return createTestCli({ commands, groups, config: { orm: config } });
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

function signResult(): SignDatabaseResult {
  return {
    ok: true,
    summary: 'Database signed',
    contract: { storageHash: HASH_A },
    target: { expected: 'postgres' },
    marker: { created: false, updated: true, previous: { storageHash: HASH_PREVIOUS } },
    timings: { total: 2 },
  };
}

beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.schemaVerify.mockReset().mockResolvedValue(schemaResult());
  mocks.sign.mockReset().mockResolvedValue(signResult());
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

describe('db sign', () => {
  describe('verification passes', () => {
    it('signs and completes at exit 0 with no diagnostics', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(diagnosticsOf(run)).toEqual([]);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      expect(run.presented?.data).toEqual(signResult());
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

    it('signs against the destination contract of a named migration dir', async () => {
      const dir = await projectDir();
      const HASH_B = `55bada2${'0'.repeat(57)}`;
      const dirName = '20260102T0000_add_users';
      const ops = [
        blindCast<MigrationPlanOperation, 'db sign reads only the destination hash'>({
          id: 'table.users',
          label: 'Create users',
          operationClass: 'additive',
        }),
      ];
      const base = blindCast<
        Omit<MigrationMetadata, 'migrationHash'>,
        'db sign reads only from/to'
      >({
        from: HASH_A,
        to: HASH_B,
        providedInvariants: [],
        createdAt: '2026-01-02T10:00:00.000Z',
      });
      const metadata: MigrationMetadata = {
        ...base,
        migrationHash: computeMigrationHash(base, ops),
      };
      await writeMigrationPackage(join(dir, 'migrations', 'app', dirName), metadata, ops);
      await writeContractSnapshot(join(dir, 'migrations'), HASH_B, {
        contractJson: { storage: { storageHash: HASH_B }, target: 'postgres' },
        contractDts: 'export type Contract = unknown;\n',
      });

      const run = await harness(ormConfig()).run(['db', 'sign', dirName, '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      const signArg = mocks.sign.mock.calls[0]?.[0] as {
        contract: { storage: { storageHash: string } };
      };
      expect(signArg.contract.storage.storageHash).toBe(HASH_B);
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
