/**
 * `db sign` contract argument shapes.
 *
 * Exercises the four argument forms from the intended surface:
 * - no argument (default: signs with emitted contract.json)
 * - positional hash prefix
 * - `--contract <hash>`
 * - `--contract <ref-name>`
 *
 * Asserts that all four produce the same marker row when the DB
 * satisfies the contract.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDocument,
  type JourneyContext,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbSign,
  runRef,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('db sign contract argument shapes', () => {
    const db = useDevDatabase();

    it(
      'all four argument shapes produce identical marker rows',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'emit').toBe(0);

        const plan = await planMigrationAndSelfEmit(ctx, ['--name', 'init', '--json']);
        expect(plan.exitCode, 'plan').toBe(0);

        const planJson = parseJsonOutput(plan);
        const contractHash = planJson?.['to'] as string;
        expect(contractHash, 'plan must produce a target hash').toBeTruthy();
        const hashPrefix = contractHash.slice(0, 8);

        const init = await runDbInit(ctx);
        expect(init.exitCode, 'init').toBe(0);

        const refSet = await runRef(ctx, ['set', 'prod', contractHash]);
        expect(refSet.exitCode, 'ref set').toBe(0);

        const signDefault = await runDbSign(ctx, ['--json']);
        expect(signDefault.exitCode, 'sign (no arg)').toBe(0);
        const markerDefault = engineDocument(signDefault);

        const signPositional = await runDbSign(ctx, [hashPrefix, '--json']);
        expect(signPositional.exitCode, 'sign (positional prefix)').toBe(0);
        const markerPositional = engineDocument(signPositional);

        const signExplicit = await runDbSign(ctx, ['--contract', contractHash, '--json']);
        expect(signExplicit.exitCode, 'sign (--contract hash)').toBe(0);
        const markerExplicit = engineDocument(signExplicit);

        const signRef = await runDbSign(ctx, ['--contract', 'prod', '--json']);
        expect(signRef.exitCode, 'sign (--contract ref)').toBe(0);
        const markerRef = engineDocument(signRef);

        const extractHash = (json: Record<string, unknown> | undefined) => {
          const spaces = json?.['spaces'] as
            | ReadonlyArray<{ readonly space: string; readonly contract: { storageHash: string } }>
            | undefined;
          return spaces?.find((entry) => entry.space === 'app')?.contract.storageHash;
        };

        const h1 = extractHash(markerDefault);
        const h2 = extractHash(markerPositional);
        const h3 = extractHash(markerExplicit);
        const h4 = extractHash(markerRef);

        expect(h1, 'default marker hash').toBeTruthy();
        expect(h2, 'positional matches default').toBe(h1);
        expect(h3, 'explicit matches default').toBe(h1);
        expect(h4, 'ref matches default').toBe(h1);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
