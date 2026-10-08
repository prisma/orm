import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

            CREATE TABLE settings (
              user_id int4 PRIMARY KEY REFERENCES users(id)
            );

            CREATE TABLE label_sets (
              id int4 PRIMARY KEY,
              labels text[] NOT NULL UNIQUE
            );

            CREATE TABLE labelled (
              id int4 PRIMARY KEY,
              labels text[] NOT NULL REFERENCES label_sets(labels)
            );
            CREATE INDEX labelled_labels_gin ON labelled USING gin (labels);

            CREATE TABLE comments (
              id int4 PRIMARY KEY,
              user_id int4 NOT NULL REFERENCES users(id)
            );
            CREATE INDEX comments_user_id_first ON comments (user_id, id);
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
        expect(relationOf('Settings'), 'the primary key serves the lookups').not.toContain(
          'index:',
        );
        expect(relationOf('Drafts'), 'a partial index does not').toContain('index: false');
        expect(relationOf('Notes'), 'a hash index does not').toContain('index: false');
        expect(relationOf('Labelled'), 'a gin index does not').toContain('index: false');
        expect(relationOf('Comments'), 'an index led by its columns is named').toContain(
          'index: "comments_user_id_first"',
        );

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);

        const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')) as {
          readonly storage: {
            readonly namespaces: Record<
              string,
              {
                readonly entries: {
                  readonly table?: Record<
                    string,
                    { readonly foreignKeys: readonly { readonly index?: unknown }[] }
                  >;
                };
              }
            >;
          };
        };
        const tables = contract.storage.namespaces['public']?.entries.table ?? {};
        expect(
          Object.fromEntries(
            ['posts', 'drafts', 'notes', 'profiles', 'settings', 'labelled', 'comments'].map(
              (table) => [table, tables[table]?.foreignKeys.map((foreignKey) => foreignKey.index)],
            ),
          ),
        ).toEqual({
          posts: [{ name: 'posts_user_id_live' }],
          drafts: [undefined],
          notes: [undefined],
          profiles: [{ unique: true }],
          settings: [{ primaryKey: true }],
          labelled: [undefined],
          comments: [{ name: 'comments_user_id_first' }],
        });

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
