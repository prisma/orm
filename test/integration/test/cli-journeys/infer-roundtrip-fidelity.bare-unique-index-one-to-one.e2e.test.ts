import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractInfer,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { readContractPsl } from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: 1:1 detection for FKs enforced by a bare CREATE UNIQUE INDEX', () => {
    // A 1:1 enforced by a plain `CREATE UNIQUE INDEX` (no UNIQUE constraint
    // object) must infer a singular back-relation, but only when the index is
    // total: a partial unique index does not guarantee at-most-one child per
    // parent, and an expression unique index never introspects a usable
    // column set at all.
    //
    // No `contract emit` here: a bare unique index has no PSL representation,
    // so the interpreter rejects the inferred singular back-relation with
    // PSL_NON_UNIQUE_BACKRELATION — a known gap tracked under TML-3086.
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE users (
              id int4 PRIMARY KEY
            );

            CREATE TABLE profiles (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id)
            );
            CREATE UNIQUE INDEX profiles_user_id_idx ON profiles (user_id);

            CREATE TABLE drafts (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id),
              archived boolean NOT NULL DEFAULT false
            );
            CREATE UNIQUE INDEX drafts_active_user_idx ON drafts (user_id) WHERE NOT archived;

            CREATE TABLE handles (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id),
              name text NOT NULL
            );
            CREATE UNIQUE INDEX handles_user_lower_name_idx ON handles (user_id, lower(name));
          `),
        ),
    });

    it(
      'a total unique index infers a singular back-relation; partial and expression indexes stay lists',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const psl = readContractPsl(ctx);
        expect(psl, 'total unique index on profiles.user_id makes the back-relation 1:1').toMatch(
          /\bprofiles\s+Profiles\?/,
        );
        expect(psl, 'partial unique index on drafts.user_id keeps a list back-relation').toMatch(
          /\bdrafts\s+Drafts\[\]/,
        );
        expect(psl, 'expression unique index on handles keeps a list back-relation').toMatch(
          /\bhandles\s+Handles\[\]/,
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
