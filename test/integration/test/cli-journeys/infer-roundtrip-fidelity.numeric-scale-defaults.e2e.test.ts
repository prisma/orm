/**
 * Infer -> Emit -> Sign -> Verify for defaults on numeric columns whose scale PostgreSQL 15 and later
 * accept outside 0..precision: a negative scale, which rounds to tens or hundreds, and a scale above
 * the precision, which holds only values below 1.
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

const SCALED_DEFAULTS_SQL = `
CREATE TABLE "scaled_defaults" (
  "id"       integer PRIMARY KEY,
  "hundreds" numeric(5, -2) DEFAULT 12300,
  "tiny"     numeric(2, 5) DEFAULT 0.00012
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
  describe('Journey: infer -> emit -> sign -> verify of numeric defaults with an unusual scale', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(SCALED_DEFAULTS_SQL)),
    });

    it(
      'infer prints each default as a number, and the emitted contract signs and verifies',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
        const fields = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')
          .split('\n')
          .map((line) => line.trim().replace(/\s+/g, ' '))
          .filter((line) => /^(?:hundreds|tiny) /.test(line));
        expect(fields).toEqual([
          'hundreds Numeric(5, -2)? @default(12300)',
          'tiny Numeric(2, 5)? @default(0.00012)',
        ]);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--strict', '--json']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
        expect(parseJsonOutput<VerifyResult>(verify), `db verify\n${output(verify)}`).toMatchObject(
          { ok: true, schema: { warnings: [] } },
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
