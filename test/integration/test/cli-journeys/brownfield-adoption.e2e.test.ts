/**
 * Brownfield Adoption (Journeys F + G)
 *
 * F — Adopt Prisma on an existing database: infer a PSL contract from the live
 *     schema, emit from that inferred PSL, verify --schema-only, sign the marker,
 *     then evolve via db update.
 *
 * G — Brownfield with schema mismatch: emit a PSL contract that doesn't match the
 *     database (extra column), observe verify --schema-only and sign failures, fix the
 *     PSL contract to match, and successfully sign.
 */

import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDiagnosticCodes,
  engineDocument,
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CREATE_USER_TABLE = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
`;

withTempDir(({ createTempDir }) => {
  describe('Journey F: Brownfield Adoption', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_USER_TABLE)),
    });

    it(
      'contract infer → emit → verify --schema-only → sign → verify → evolve → db update',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `F.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        expect(stripAnsi(infer.stderr), 'F.01: success message').toContain(
          'Contract written to contract.prisma',
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `F.02: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'F.03: db verify --schema-only').toBe(0);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'F.04: db sign').toBe(0);

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'F.05: db verify').toBe(0);

        swapPslContract(ctx, 'contract-additive');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, 'F.06: contract emit v2').toBe(0);

        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'F.07: db update').toBe(0);

        const signJson = await runDbSign(ctx, ['--json']);
        expect(signJson.exitCode, 'F.08: db sign json').toBe(0);
        expect(engineDocument(signJson), 'F.08: json ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey G: Brownfield Mismatch', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_USER_TABLE)),
    });

    it(
      'contract infer → emit mismatch → verify --schema-only fails → sign fails → fix → pass',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `G.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        swapPslContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `G.02: contract emit mismatch\n${stripAnsi(emit.stderr)}`).toBe(0);

        const schemaVerifyFail = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyFail.exitCode, 'G.03: db verify --schema-only reports drift').toBe(4);
        expect(engineDiagnosticCodes(schemaVerifyFail)).toContain(
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        );

        const signFail = await runDbSign(ctx);
        expect(signFail.exitCode, 'G.04: db sign refuses to sign').toBe(4);

        const signJsonFail = await runDbSign(ctx, ['--json']);
        expect(signJsonFail.exitCode, 'G.05: db sign json refuses to sign').toBe(4);
        expect(engineDiagnosticCodes(signJsonFail), 'G.05: the refusal is the finding').toEqual([
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        ]);
        expect(
          engineDocument(signJsonFail),
          'G.05: the app space is reported with its verify result',
        ).toMatchObject({
          ok: false,
          spaces: [
            {
              space: 'app',
              status: 'failed',
              schema: { ok: false, code: 'CONTRACT.SCHEMA_VERIFICATION_FAILED' },
            },
          ],
        });

        swapPslContract(ctx, 'contract-base');
        const emitFixed = await runContractEmit(ctx);
        expect(emitFixed.exitCode, 'G.06: contract emit fixed').toBe(0);

        const schemaVerifyPass = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyPass.exitCode, 'G.07: db verify --schema-only passes').toBe(0);

        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'G.08: db sign').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
