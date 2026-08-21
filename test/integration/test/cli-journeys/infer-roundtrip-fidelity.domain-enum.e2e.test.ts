import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbInit,
  runDbUpdate,
  setupJourney,
  sql,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { expectVerifiesCleanAfterPull, readContractPsl } from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: emit → migrate → infer round-trips a domain enum', () => {
    // Path A end to end: the toolchain itself installs the derived,
    // wire-named membership check (never a precomputed name), and the re-pull
    // recovers the same enum — same name, same member order — with the
    // constraint proven by the content hash, not re-parsed. A native enum on
    // the same table proves the recovered enum prints top-level while the
    // rest stays inside the namespace wrap.
    const db = useDevDatabase();

    it(
      'the re-pull returns the authored enum in order and verifies clean with no pending operations',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        swapPslContract(ctx, 'contract-domain-enum');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${stripAnsi(init.stderr)}`).toBe(0);

        // The toolchain installed the derived wire-named membership check.
        const live = await sql(
          db.connectionString,
          `SELECT conname FROM pg_catalog.pg_constraint WHERE contype = 'c' AND conrelid = 'accounts'::regclass`,
        );
        expect(live.rows.map((row) => row['conname'])).toEqual([
          expect.stringMatching(/^accounts_role_check_[0-9a-f]{8}$/),
        ]);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const psl = readContractPsl(ctx);

        expect(psl, 'the enum comes back under its derived name').toContain('enum AccountsRole {');
        expect(psl).toContain('@@type("pg/text@1")');
        expect(psl, 'the column is typed by the recovered enum').toMatch(/role\s+AccountsRole\n/);
        expect(psl, 'the proven check emits neither @@check nor @noCheck').not.toContain('@@check');
        expect(psl).not.toContain('@noCheck');
        expect(
          psl.indexOf('user = "user"'),
          'members keep the authored, non-alphabetical order',
        ).toBeGreaterThan(0);
        expect(psl.indexOf('user = "user"')).toBeLessThan(psl.indexOf('admin = "admin"'));

        expect(psl, 'the native enum survives inside the namespace wrap').toContain(
          'native_enum AalLevel {',
        );
        expect(
          psl.indexOf('enum AccountsRole {'),
          'the recovered enum prints top-level, before the namespace wrap',
        ).toBeLessThan(psl.indexOf('namespace public {'));

        const emitAfterInfer = await runContractEmit(ctx);
        expect(
          emitAfterInfer.exitCode,
          `contract emit after infer\n${stripAnsi(emitAfterInfer.stderr)}`,
        ).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'domain enum round-trip');

        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `db update --dry-run\n${stripAnsi(dryRun.stderr)}`).toBe(0);
        const plan = parseJsonOutput<{
          readonly plan: { readonly operations: readonly { readonly id: string }[] };
        }>(dryRun);
        expect(
          plan.plan.operations.map((op) => op.id),
          'the re-pulled contract plans no operations',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
