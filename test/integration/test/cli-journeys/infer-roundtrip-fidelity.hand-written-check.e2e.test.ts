import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { expectVerifiesCleanAfterPull, readContractPsl } from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: a hand-written check is declared by infer and survives a destructive plan', () => {
    // A live check whose name is not a derived wire shape is a hand-written
    // constraint: infer declares it via `@@check(expression: <reprint>, map:
    // <physical name>)`, carrying Postgres's own reprint of the predicate.
    // Once declared, the constraint is no longer an undeclared extra, so a
    // plan run under a policy that allows destructive operations no longer
    // drops it — this is the defect the check-constraint-unification project
    // exists to close (projects/sql-check-constraint-unification/slices/
    // authored-check-constraints/spec.md, "The defect").
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE users (
              id int4 PRIMARY KEY,
              tags text[] NOT NULL,
              CONSTRAINT users_tags_not_empty CHECK (cardinality(tags) > 0)
            );
          `),
        ),
    });

    it(
      'infer declares the hand-written check, verify is clean, and a destructive-allowing plan does not drop it',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(psl, 'the derived element check is still waived').toMatch(
          /tags\s+String\[\][^\n]*@noCheck\(elementNotNull\)/,
        );
        expect(
          psl,
          'the hand-written check is now declared, carrying the live reprint via map:',
        ).toMatch(
          /@@check\(expression: "\(cardinality\(tags\) > 0\)", map: "users_tags_not_empty"\)/,
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'hand-written check');

        // The constraint is now declared, so it is no longer a strict-only extra.
        const strict = await runDbVerify(ctx, ['--schema-only', '--strict']);
        const strictOutput = `${stripAnsi(strict.stderr)}\n${stripAnsi(strict.stdout)}`;
        expect(strict.exitCode, `strict verify should be clean\n${strictOutput}`).toBe(0);

        // The defect, closed: on `main`, a plan under a policy that allows
        // destructive operations drops this constraint because the contract
        // has no way to declare it. `@@check` closes that — the plan must
        // carry no `dropCheckConstraint` naming it.
        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `db update --dry-run\n${stripAnsi(dryRun.stderr)}`).toBe(0);
        const plan = parseJsonOutput<{
          readonly plan: { readonly operations: readonly { readonly id: string }[] };
        }>(dryRun);
        const opIds = plan.plan.operations.map((op) => op.id);
        expect(
          opIds.filter((id) => id.includes('CheckConstraint')),
          'no check-constraint operations for the hand-written check',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
