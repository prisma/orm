/**
 * Contract Infer Workflow (Journey AB)
 *
 * A brownfield project keeps a PSL contract on disk. `contract infer` refreshes
 * that PSL from the live schema, `contract emit` consumes it, and re-running
 * infer without schema changes stays stable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
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
  CREATE ROLE workflow_app_user;
  ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY user_self_read ON "user"
    AS PERMISSIVE FOR SELECT TO workflow_app_user
    USING (id = 1);
`;

withTempDir(({ createTempDir }) => {
  describe('Journey AB: Contract Infer Workflow', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(CREATE_USER_TABLE)),
    });

    it(
      'refresh psl from live schema → emit → verify --schema-only → infer again stably',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        swapPslContract(ctx, 'contract-additive');
        const stalePsl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(stalePsl, 'AB.pre: stale psl differs from db').toMatch(/\bname\s+String/);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `AB.01: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        expect(stripAnsi(infer.stderr), 'AB.01: success message').toContain(
          'Contract written to contract.prisma',
        );
        const inferredPsl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(inferredPsl, 'AB.01: inferred psl includes pragma').toContain('// use prisma-8');
        expect(inferredPsl, 'AB.01: infer removes stale field').not.toMatch(/\bname\s+String/);
        expect(inferredPsl, 'AB.01: infer keeps live field').toContain('email String');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'AB.02: contract emit').toBe(0);

        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'AB.03: db verify --schema-only').toBe(0);

        const inferAgain = await runContractInfer(ctx);
        expect(inferAgain.exitCode, 'AB.04: contract infer again').toBe(0);
        const inferredAgainPsl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
        expect(inferredAgainPsl, 'AB.04: infer-twice is stable').toBe(inferredPsl);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
