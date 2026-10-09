/**
 * Prisma 7 keeps its applied migrations in `_prisma_migrations`, a table in the application schema that belongs to Prisma 7, not to the application. `contract infer` prints no model for it, `db schema` does not show it, and `db verify --strict` does not report it as unclaimed. A contract that declares a table of that name gets it verified like any declared table.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDocument,
  runContractEmit,
  runContractInfer,
  runDbSchema,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_DATABASE = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
  CREATE TABLE "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  );
`;

const CONTRACT_DECLARING_LEDGER = `// use prisma-8

model User {
  id    Int    @id
  email String

  @@map("user")
}

model Ledger {
  id    String @id
  extra Int

  @@map("_prisma_migrations")
}
`;

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

interface VerifyData {
  readonly ok: boolean;
  readonly schema: { readonly issues: readonly { readonly path: readonly string[] }[] };
  readonly unclaimed: readonly string[];
}

withTempDir(({ createTempDir }) => {
  describe('Journey: Prisma 7 migration ledger', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRISMA7_DATABASE)),
    });

    it(
      'contract infer prints no model for it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
        const inferred = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(inferred).toContain('@@map("user")');
        expect(inferred).not.toContain('_prisma_migrations');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db schema does not show it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const schema = await runDbSchema(ctx, ['--json']);
        const printed = JSON.stringify(engineDocument(schema));
        expect(schema.exitCode, `db schema\n${output(schema)}`).toBe(0);
        expect(printed).toContain('"user"');
        expect(printed).not.toContain('_prisma_migrations');
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db verify --strict does not report it as unclaimed and db update plans nothing for it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        const strictVerify = await runDbVerify(ctx, ['--json', '--strict']);
        expect(strictVerify.exitCode, `db verify --strict\n${output(strictVerify)}`).toBe(0);
        const data = strictVerify.presented?.data as VerifyData;
        expect({ ok: data.ok, unclaimed: data.unclaimed }).toEqual({ ok: true, unclaimed: [] });

        const update = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(update.exitCode, `db update --dry-run\n${output(update)}`).toBe(0);
        expect(engineDocument(update)).toMatchObject({ ok: true, plan: { operations: [] } });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a contract that declares _prisma_migrations has it verified like any declared table',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), CONTRACT_DECLARING_LEDGER, 'utf-8');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--json', '--schema-only']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(4);
        const data = verify.presented?.data as VerifyData;
        expect(data.schema.issues.map((issue) => issue.path).sort()).toEqual([
          ['database', 'public', '_prisma_migrations', 'column:extra'],
          ['database', 'public', '_prisma_migrations', 'column:id'],
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
