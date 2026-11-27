import { DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import { writeRef } from '@internal/migration-tools/refs';
import { notOk, ok } from '@internal/utils/result';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliStructuredError } from '../../src/utils/cli-errors';
import { errorDatabasePoliciesMovedDuringSign } from '../../src/utils/policy-errors';
import type { CliInvocation } from '../../src/utils/printed-command';
import {
  CONNECTION,
  cleanupProjectDirs,
  DATABASE_NOT_PROVIDED,
  DRIFTED,
  diagnosticsOf,
  envelopeOf,
  failedSpace,
  HASH_A,
  HASH_EXT,
  HASH_PREVIOUS,
  harness,
  MASKED_CONNECTION,
  MISSING_COLUMN,
  mocks,
  NOT_PROVIDED,
  OLDER_THAN_SUPPORTED,
  ormConfig,
  PROFILE_HASH,
  projectDir,
  refsDirOf,
  resetMocks,
  signedSpace,
} from './db-sign-fixtures';
import {
  refusedConnection,
  refusedWithDiagnostics,
  reportedDiagnostics,
  reportedRefusedConnection,
} from './unreachable-database';

beforeEach(resetMocks);
afterEach(cleanupProjectDirs);

const HEADER = {
  kind: 'fields',
  rail: true,
  rows: [
    { label: 'contract', value: 'output/contract.json' },
    { label: 'database', value: MASKED_CONNECTION },
  ],
};

describe('db sign', () => {
  describe('every space verifies', () => {
    it('signs and completes at exit 0 with no diagnostics', async () => {
      const dir = await projectDir();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(0);
      expect(diagnosticsOf(run)).toEqual([]);
      expect(mocks.dbSign).toHaveBeenCalledTimes(1);
      expect(run.presented?.data).toEqual({
        ok: true,
        summary: 'Database signed',
        spaces: [signedSpace('app', HASH_A)],
        advancedRefs: [{ space: 'app', name: 'db', hash: HASH_A }],
      });
    });

    it('hands the operation the contract read through the family seam and the connection', async () => {
      const dir = await projectDir();

      await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(mocks.dbSign).toHaveBeenCalledWith(
        expect.objectContaining({
          contract: expect.objectContaining({ hydrated: true }),
          connection: CONNECTION,
        }),
      );
    });

    it('names each space and what signing did to it', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({
          spaces: [
            signedSpace('app', HASH_A),
            {
              space: 'pgvector',
              status: 'unchanged',
              contract: { storageHash: HASH_EXT, profileHash: PROFILE_HASH },
            },
          ],
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human).toEqual([
        HEADER,
        {
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
              label: [
                { text: 'pgvector: unchanged, already signed with ' },
                { text: HASH_EXT, tone: 'identifier' },
              ],
              status: 'ok',
            },
          ],
        },
        { kind: 'summary', status: 'ok', text: 'Database signed' },
        {
          kind: 'summary',
          status: 'info',
          tone: 'muted',
          text: 'Left ref "db" untouched (--no-advance-ref)',
        },
      ]);
    });

    it('prints one data line per space: space, status and the contract storage hash', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({
          spaces: [
            signedSpace('app', HASH_A),
            {
              space: 'pgvector',
              status: 'unchanged',
              contract: { storageHash: HASH_EXT, profileHash: PROFILE_HASH },
            },
          ],
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], { cwd: dir });

      expect(run.stdout).toBe(`app\tupdated\t${HASH_A}\npgvector\tunchanged\t${HASH_EXT}\n`);
    });

    it('says when a space had no marker before', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({
          spaces: [
            {
              space: 'app',
              status: 'created',
              contract: { storageHash: HASH_A, profileHash: PROFILE_HASH },
            },
          ],
        }),
      );

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
              { text: ' (no marker before)', tone: 'muted' },
            ],
            status: 'ok',
          },
        ],
      });
    });
  });

  describe('a space fails verification', () => {
    function appFailsExtensionSigns() {
      mocks.dbSign.mockResolvedValue(
        ok({ spaces: [failedSpace('app', HASH_A), signedSpace('pgvector', HASH_EXT)] }),
      );
    }

    it('completes at exit 4 and reports every space', async () => {
      const dir = await projectDir();
      appFailsExtensionSigns();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({ ok: true, exitCode: 4 });
      expect(run.presented?.data).toEqual({
        ok: false,
        summary: 'Database schema does not satisfy contract for space "app"; signed "pgvector"',
        spaces: [failedSpace('app', HASH_A), signedSpace('pgvector', HASH_EXT)],
        advancedRefs: [{ space: 'pgvector', name: 'db', hash: HASH_EXT }],
      });
    });

    it('prints a failed space with status failed', async () => {
      const dir = await projectDir();
      appFailsExtensionSigns();

      const run = await harness(ormConfig()).run(['db', 'sign'], { cwd: dir });

      expect(run.stdout).toBe(`app\tfailed\t${HASH_A}\npgvector\tupdated\t${HASH_EXT}\n`);
    });

    it('says nothing was signed when no space verified', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(ok({ spaces: [failedSpace('app', HASH_A)] }));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({
        summary: 'Database schema does not satisfy contract for space "app"; signed nothing',
        advancedRefs: [],
      });
    });

    it('carries one error diagnostic per failed space', async () => {
      const dir = await projectDir();
      appFailsExtensionSigns();

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(
        diagnosticsOf(run).map((entry) => ({
          code: entry.code,
          severity: entry.severity,
          summary: entry.summary,
          meta: entry.meta,
        })),
      ).toEqual([
        {
          code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
          severity: 'error',
          summary: 'Database schema does not satisfy contract',
          meta: { space: 'app', schemaIssues: [MISSING_COLUMN] },
        },
      ]);
      expect(diagnosticsOf(run)[0]?.nextActions).toEqual([
        {
          kind: 'run-command',
          label: 'Change the database to match the contract, then sign again',
          command: 'prisma-test db update',
        },
        {
          kind: 'user-choice',
          label:
            'Or change the contract source to describe the database as it is, re-run contract emit, then sign again',
        },
      ]);
    });

    it('aims db update at the ref being signed, and the contract change at the emitted contract', async () => {
      const dir = await projectDir();
      await writeRef(refsDirOf(dir), 'staging', { hash: HASH_A, invariants: [] });
      mocks.dbSign.mockResolvedValue(ok({ spaces: [failedSpace('app', HASH_A)] }));

      const run = await harness(ormConfig()).run(['db', 'sign', 'staging', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run)[0]?.nextActions).toEqual([
        {
          kind: 'run-command',
          label: 'Change the database to match the contract, then sign again',
          command: 'prisma-test db update --to "staging"',
        },
        {
          kind: 'user-choice',
          label:
            'Or change the contract source to describe the database as it is, re-run contract emit, then sign the emitted contract instead of "staging"',
        },
      ]);
    });

    it('offers no db update for a database whose change policy permits only migrations, and repeats --force', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({ spaces: [failedSpace('app', HASH_A)], changePolicy: ['migrate'] }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--force', '--json'], {
        cwd: dir,
      });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run)[0]?.nextActions).toEqual([
        {
          kind: 'run-command',
          label:
            'If the database is at an earlier contract, sign that contract by the directory of the last migration it applied, then run db migrate',
          command: 'prisma-test db sign <migration directory> --force',
        },
        {
          kind: 'user-choice',
          label:
            'Otherwise author migrations that bring the database back onto the migration graph, then run db migrate',
        },
        {
          kind: 'user-choice',
          label:
            'Or change the contract source to describe the database as it is, re-run contract emit, then sign again',
        },
      ]);
    });

    it('offers db update for a database whose change policy permits reconcile', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({ spaces: [failedSpace('app', HASH_A)], changePolicy: ['migrate', 'reconcile'] }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(diagnosticsOf(run)[0]?.nextActions?.[0]).toEqual({
        kind: 'run-command',
        label: 'Change the database to match the contract, then sign again',
        command: 'prisma-test db update',
      });
    });

    it('draws the drift under the failed space and closes with the failing summary', async () => {
      const dir = await projectDir();
      appFailsExtensionSigns();

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
        cwd: dir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human.slice(1, 3)).toEqual([
        {
          kind: 'tree',
          roots: [
            {
              label: 'app: not signed, the schema does not satisfy its contract',
              status: 'error',
              children: [{ label: 'missing: public/users/email', status: 'error' }],
            },
            {
              label: [
                { text: 'pgvector: signed ' },
                { text: HASH_EXT, tone: 'identifier' },
                { text: ' (was ', tone: 'muted' },
                { text: HASH_PREVIOUS, tone: 'identifier' },
                { text: ')', tone: 'muted' },
              ],
              status: 'ok',
            },
          ],
        },
        {
          kind: 'summary',
          status: 'error',
          text: 'Database schema does not satisfy contract for space "app"; signed "pgvector"',
        },
      ]);
    });
  });

  describe('the database does not provide what the contract requires', () => {
    it('says so in the text the result carries, and offers no drift advice', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(ok({ spaces: [failedSpace('app', HASH_A, NOT_PROVIDED)] }));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(4);
      expect(diagnosticsOf(run)).toEqual([
        {
          code: 'CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED',
          severity: 'error',
          summary: OLDER_THAN_SUPPORTED,
          nextActions: [],
          meta: { space: 'app', schemaIssues: [DATABASE_NOT_PROVIDED] },
        },
      ]);
    });

    it('names the cause on the failed space and in the summary, prints the text once, and no db update line', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(ok({ spaces: [failedSpace('app', HASH_A, NOT_PROVIDED)] }));

      const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
        cwd: dir,
        isTty: { stdout: true, stderr: true },
      });
      const shown = stripAnsi(`${run.stderr}\n${run.stdout}`);

      expect(run.presented?.presentation.human.slice(1, 3)).toEqual([
        {
          kind: 'tree',
          roots: [
            {
              label: 'app: not signed, the database does not provide what its contract requires',
              status: 'error',
              children: [],
            },
          ],
        },
        {
          kind: 'summary',
          status: 'error',
          text: 'The database does not provide what the contract requires for space "app"; signed nothing',
        },
      ]);
      expect(shown.split(OLDER_THAN_SUPPORTED).length - 1).toBe(1);
      expect(shown).not.toContain('db update');
    });

    it('carries the same summary in --json', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(ok({ spaces: [failedSpace('app', HASH_A, NOT_PROVIDED)] }));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.presented?.data).toMatchObject({
        summary:
          'The database does not provide what the contract requires for space "app"; signed nothing',
      });
    });

    describe('when the schema also differs', () => {
      const lackingAndDrifted = failedSpace('app', HASH_A, {
        ...NOT_PROVIDED,
        schema: { issues: [DATABASE_NOT_PROVIDED, MISSING_COLUMN] },
      });

      it('leads with the refusal, lists the drift, and offers no command that changes the database', async () => {
        const dir = await projectDir();
        mocks.dbSign.mockResolvedValue(ok({ spaces: [lackingAndDrifted] }));

        const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

        expect(run.exitCode).toBe(4);
        expect(diagnosticsOf(run)).toEqual([
          {
            code: 'CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED',
            severity: 'error',
            summary: OLDER_THAN_SUPPORTED,
            why: '`db update`, `db init` and `db migrate` refuse this database until it provides what the contract requires. The live schema also differs: missing: public/users/email.',
            nextActions: [],
            meta: { space: 'app', schemaIssues: [DATABASE_NOT_PROVIDED, MISSING_COLUMN] },
          },
        ]);
      });

      it('names the refusal on the space and in the summary, draws the drift under it, and prints no db update line', async () => {
        const dir = await projectDir();
        mocks.dbSign.mockResolvedValue(ok({ spaces: [lackingAndDrifted] }));

        const run = await harness(ormConfig()).run(['db', 'sign', '--no-advance-ref'], {
          cwd: dir,
          isTty: { stdout: true, stderr: true },
        });
        const shown = stripAnsi(`${run.stderr}\n${run.stdout}`);

        expect(run.presented?.presentation.human.slice(1, 3)).toEqual([
          {
            kind: 'tree',
            roots: [
              {
                label: 'app: not signed, the database does not provide what its contract requires',
                status: 'error',
                children: [{ label: 'missing: public/users/email', status: 'error' }],
              },
            ],
          },
          {
            kind: 'summary',
            status: 'error',
            text: 'The database does not provide what the contract requires for space "app"; signed nothing',
          },
        ]);
        expect(shown).not.toContain('prisma-test db update');
      });
    });

    it('offers no drift advice for the drift of another space either, and says why, since db update, db init and db migrate refuse the database', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockResolvedValue(
        ok({
          spaces: [
            failedSpace('app', HASH_A, NOT_PROVIDED),
            failedSpace('pgvector', HASH_EXT, DRIFTED),
          ],
        }),
      );

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(diagnosticsOf(run)).toEqual([
        {
          code: 'CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED',
          severity: 'error',
          summary: OLDER_THAN_SUPPORTED,
          nextActions: [],
          meta: { space: 'app', schemaIssues: [DATABASE_NOT_PROVIDED] },
        },
        {
          code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED',
          severity: 'error',
          summary: 'Database schema does not satisfy contract',
          why: '`db update`, `db init` and `db migrate` refuse this database until it provides what the contract of another space requires. The live schema differs: missing: public/users/email.',
          nextActions: [],
          meta: { space: 'pgvector', schemaIssues: [MISSING_COLUMN] },
        },
      ]);
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
      expect(mocks.dbSign).not.toHaveBeenCalled();
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
      expect(mocks.dbSign).not.toHaveBeenCalled();
    });

    it.each(['@empty', '@contract', '@db'])(
      'refuses the reserved reference %s with the wrong-grammar envelope',
      async (input) => {
        const dir = await projectDir();

        const run = await harness(ormConfig()).run(['db', 'sign', input, '--json'], { cwd: dir });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: {
            code: 'MIGRATION.REF_WRONG_GRAMMAR',
            why: `"${input}" is a reserved reference; the contract argument takes a contract recorded in the migrations directory (hash, prefix, ref name, migration dir name, or <dir>^)`,
            meta: { input, expectedGrammar: 'contract' },
          },
        });
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.dbSign).not.toHaveBeenCalled();
      },
    );

    it('reports a refused connection as every command does, with its driver code', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockRejectedValue(refusedConnection());

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)?.error).toEqual(reportedRefusedConnection('db sign'));
    });

    it('keeps the diagnostics of a structured driver error, without the connection string', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockRejectedValue(refusedWithDiagnostics());

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'DRIVER.CONNECTION_FAILED' },
        diagnostics: reportedDiagnostics,
      });
      expect(JSON.stringify(run.json.at(-1))).not.toContain('secret');
    });

    it('errors at exit 2 when the driver throws, without leaking the connection string', async () => {
      const dir = await projectDir();
      mocks.dbSign.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

      const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({ ok: false, error: { code: 'CLI.UNEXPECTED' } });
      expect(JSON.stringify(run.json.at(-1))).not.toContain('secret');
      expect(mocks.close).toHaveBeenCalled();
    });
  });

  it('errors at exit 2 when the contract spaces cannot be loaded', async () => {
    const dir = await projectDir();
    mocks.dbSign.mockResolvedValue(
      notOk(
        new CliStructuredError(
          'MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION',
          'Contract-space layout violation detected',
        ),
      ),
    );

    const run = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION' },
    });
  });

  it('signs with the change policy overridden only when --force is given', async () => {
    const dir = await projectDir();

    await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });
    await harness(ormConfig()).run(['db', 'sign', '--force', '--json'], { cwd: dir });

    expect(mocks.dbSign.mock.calls.map(([options]) => options.force)).toEqual([false, true]);
  });

  it('describes --force in --help', async () => {
    const dir = await projectDir();

    const run = await harness(ormConfig()).run(['db', 'sign', '--help'], { cwd: dir });

    expect(`${run.stdout}${run.stderr}`).toMatch(
      /--force +Sign even if the database's change policy permits only migrations; the schema is still verified and the policies are kept/,
    );
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

describe('db sign when the policies move while it runs', () => {
  it('advises signing again with the contract and ref flags the user gave', async () => {
    mocks.dbSign.mockImplementation(async (options: { invocation: CliInvocation }) =>
      notOk(
        errorDatabasePoliciesMovedDuringSign({
          spaceId: 'app',
          checked: DEFAULT_DATABASE_POLICIES,
          found: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
          invocation: options.invocation,
        }),
      ),
    );
    const dir = await projectDir();
    await writeRef(refsDirOf(dir), 'production', { hash: HASH_A, invariants: [] });

    const run = await harness(ormConfig()).run(
      ['db', 'sign', '--contract', 'production', '--no-advance-ref', '--json'],
      { cwd: dir },
    );

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run)?.error).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      nextActions: [
        {
          kind: 'run-command',
          label: 'Sign again',
          command: 'prisma-test db sign --contract production --no-advance-ref',
        },
      ],
    });
  });

  it('repeats --force in the command to sign again only when the user gave it', async () => {
    mocks.dbSign.mockImplementation(async (options: { invocation: CliInvocation }) =>
      notOk(
        errorDatabasePoliciesMovedDuringSign({
          spaceId: 'app',
          checked: DEFAULT_DATABASE_POLICIES,
          found: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
          invocation: options.invocation,
        }),
      ),
    );
    const dir = await projectDir();

    const forced = await harness(ormConfig()).run(['db', 'sign', '--force', '--json'], {
      cwd: dir,
    });
    const plain = await harness(ormConfig()).run(['db', 'sign', '--json'], { cwd: dir });

    expect([envelopeOf(forced)?.error, envelopeOf(plain)?.error]).toMatchObject([
      { nextActions: [{ command: 'prisma-test db sign --force' }] },
      { nextActions: [{ command: 'prisma-test db sign' }] },
    ]);
  });
});
