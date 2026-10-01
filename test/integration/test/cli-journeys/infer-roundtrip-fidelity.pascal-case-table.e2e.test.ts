import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { expectVerifiesCleanAfterPull, readContractPsl } from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: a PascalCase table round-trips through infer -> emit -> verify', () => {
    // A model with no `@@map` names its table verbatim, so a PascalCase
    // table infers to a model of the same name with no `@@map`, and that
    // model verifies clean against the table.
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE "LegacyAccount" (
              "id" integer PRIMARY KEY,
              "email" text NOT NULL
            );
          `),
        ),
    });

    it(
      'infer omits @@map for a PascalCase table and db verify finds the table',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'LegacyAccount');

        const psl = readContractPsl(ctx);
        expect(psl, 'the model keeps the PascalCase name').toMatch(/^model LegacyAccount \{/m);
        expect(psl, 'the verbatim model name needs no @@map').not.toContain(
          '@@map("LegacyAccount")',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
