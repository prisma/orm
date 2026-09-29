/**
 * Infer -> Emit -> Sign -> Verify for list defaults Postgres stores in brace form with unquoted
 * elements, such as `'{a,b}'::text[]`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BRACE_DEFAULTS_SQL = `
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TABLE "brace_defaults" (
  "id"     integer PRIMARY KEY,
  "words"  text[] DEFAULT '{a,b}',
  "flags"  boolean[] DEFAULT '{true,false}',
  "roles"  "Role"[] DEFAULT '{USER}',
  "names"  character varying[] DEFAULT '{x}',
  "days"   date[] DEFAULT '{2024-01-01}'
);
`;

interface VerifyResult {
  readonly ok: boolean;
  readonly schema: { readonly warnings: readonly unknown[] };
}

function output(run: EngineCommandResult): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: infer -> emit -> sign -> verify of brace-form list defaults', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(BRACE_DEFAULTS_SQL)),
    });

    it(
      'infer prints each default as a literal list, and the emitted contract signs and verifies',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
        expect(readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')).toMatchInlineSnapshot(`
          "// use prisma-8
          // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

          namespace public {
            model BraceDefaults {
              id    Int              @id(map: "brace_defaults_pkey")
              words String[]?        @default(["a", "b"]) @noCheck(elementNotNull)
              flags Boolean[]?       @default([true, false]) @noCheck(elementNotNull)
              roles pg.enum(Role)[]? @default(["USER"]) @noCheck(elementNotNull)
              names VarChar[]?       @default(["x"]) @noCheck(elementNotNull)
              days  Date[]?          @default(["2024-01-01"]) @noCheck(elementNotNull)

              @@map("brace_defaults")
            }

            native_enum Role {
              USER = "USER"
              ADMIN = "ADMIN"
            }
          }
          "
        `);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--strict', '--json']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
        expect(parseJsonOutput<VerifyResult>(verify), `db verify\n${output(verify)}`).toMatchObject(
          {
            ok: true,
            schema: { warnings: [] },
          },
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
