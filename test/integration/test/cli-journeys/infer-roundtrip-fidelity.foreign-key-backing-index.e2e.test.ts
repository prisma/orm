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
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import { expectVerifiesCleanAfterPull, readContractPsl } from './infer-roundtrip-fidelity/harness';

withTempDir(({ createTempDir }) => {
  describe('Journey: contract infer and the backing index of each foreign key', () => {
    const db = useDevDatabase({
      onReady: (cs) =>
        withClient(cs, (client) =>
          client.query(`
            CREATE TABLE users (
              id int4 PRIMARY KEY
            );

            CREATE TABLE posts (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id)
            );
            CREATE INDEX posts_user_id_live ON posts (user_id);

            CREATE TABLE drafts (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id),
              archived boolean NOT NULL DEFAULT false
            );
            CREATE INDEX drafts_user_id_open ON drafts (user_id) WHERE NOT archived;

            CREATE TABLE notes (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id)
            );
            CREATE INDEX notes_user_id_hash ON notes USING hash (user_id);

            CREATE TABLE profiles (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL UNIQUE REFERENCES users(id)
            );
          `),
        ),
    });

    it(
      'keeps the derived backing index only where a live index matches it, and the round trip plans no change',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);

        const relationOf = (model: string) =>
          readContractPsl(ctx)
            .split(/^model /m)
            .find((block) => block.startsWith(`${model} `))
            ?.split('\n')
            .find((line) => line.includes('@relation'));
        expect(relationOf('Posts'), 'a default index matches the derived one').not.toContain(
          'index:',
        );
        expect(relationOf('Profiles'), 'a unique constraint serves the lookups').not.toContain(
          'index:',
        );
        expect(relationOf('Drafts'), 'a partial index does not').toContain('index: false');
        expect(relationOf('Notes'), 'a hash index does not').toContain('index: false');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        await expectVerifiesCleanAfterPull(ctx, 'foreign key backing indexes');

        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `db update --dry-run\n${stripAnsi(dryRun.stderr)}`).toBe(0);
        const plan = parseJsonOutput<{
          readonly plan: { readonly operations: readonly { readonly id: string }[] };
        }>(dryRun);
        expect(plan.plan.operations).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
