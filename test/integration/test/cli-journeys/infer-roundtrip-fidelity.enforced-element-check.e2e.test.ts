import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runDbUpdate,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  expectVerifiesCleanAfterPull,
  readContractPsl,
  writeContractPsl,
} from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: infer preserves an enforced element check', () => {
    // The enforced check is installed by the toolchain itself rather than
    // seeded with a precomputed name: sign the opted-out pull, delete the
    // `@noCheck` attribute, and let `db update` install the derived
    // wire-named check. The re-pull must then infer the enforced form. This
    // keeps the journey on the published import root — no internal naming
    // helpers — and proves the name the toolchain installs is the name infer
    // compares against.
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE users (
              id int4 PRIMARY KEY,
              tags text[] NOT NULL
            );
          `),
        ),
    });

    it(
      'a live wire-named element check infers the enforced form and verifies clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const pulled = readContractPsl(ctx);
        expect(pulled, 'the pull of a check-less database is opted out').toMatch(
          /tags\s+String\[\][^\n]*@noCheck\(elementNotNull\)/,
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${stripAnsi(sign.stderr)}`).toBe(0);

        // The author accepts enforcement: delete the opt-out and apply.
        writeContractPsl(ctx, pulled.replace(/\s*@noCheck\(elementNotNull\)/, ''));
        const emitEnforced = await runContractEmit(ctx);
        expect(emitEnforced.exitCode, `contract emit\n${stripAnsi(emitEnforced.stderr)}`).toBe(0);
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, `db update\n${stripAnsi(update.stderr)}`).toBe(0);

        // The toolchain installed the derived wire-named check.
        await withClient(db.connectionString, async (client) => {
          const live = await client.query(
            `SELECT conname FROM pg_catalog.pg_constraint WHERE contype = 'c' AND conrelid = 'users'::regclass`,
          );
          expect(live.rows.map((row) => row['conname'])).toEqual([
            expect.stringMatching(/^users_tags_elem_not_null_[0-9a-f]{8}$/),
          ]);
        });

        // A fresh pull now sees the live check under the derived name.
        const repull = await runContractInfer(ctx);
        expect(repull.exitCode, `contract infer (re-pull)\n${stripAnsi(repull.stderr)}`).toBe(0);
        const psl = readContractPsl(ctx);
        expect(psl, 'the enforced form carries no opt-out').not.toContain('@noCheck');

        const emitRepull = await runContractEmit(ctx);
        expect(emitRepull.exitCode, `contract emit\n${stripAnsi(emitRepull.stderr)}`).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'enforced element check');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
