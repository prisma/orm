/**
 * A raw SQL default the database stores in its own form. Postgres stores `now() - interval '1 day'`
 * as `(now() - '1 day'::interval)`, so the schema check after apply fails. The output names the
 * stored text, the `sql` literal that writes it, and how to plan the failed migration again.
 * Following that advice word for word ends clean, with the stored default unchanged.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const HEDGE =
  'The database may store a default expression in its own form, so the two can mean the same.';

function schema(type: string, literal: string): string {
  return `// use prisma-8

model Event {
  id Int     @id
  at ${type} @default(${literal})
}
`;
}

function shownOutput(result: { readonly stdout: string; readonly stderr: string }): string {
  return stripAnsi(`${result.stderr}\n${result.stdout}`);
}

function storageHash(ctx: JourneyContext): string {
  const contractJson: { readonly storage: { readonly storageHash: string } } = JSON.parse(
    readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'),
  );
  return contractJson.storage.storageHash;
}

function withoutContinuationIndent(text: string): string {
  return text.replace(/\n {7}/g, '\n');
}

async function storedDefault(connectionString: string): Promise<string | undefined> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<{ expression: string }>(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
         FROM pg_attrdef d
         JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = '"Event"'::regclass AND a.attname = 'at'`,
    );
    return result.rows[0]?.expression;
  });
}

function writeContract(ctx: JourneyContext, text: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), text);
}

const cases = [
  {
    name: 'an interval',
    type: 'TimestamptzTemporal',
    written: "sql`now() - interval '1 day'`",
    stored: "(now() - '1 day'::interval)",
    literal: "sql`(now() - '1 day'::interval)`",
  },
  {
    name: 'a string constant holding a backslash',
    type: 'String',
    written: String.raw`sql` + '`' + String.raw`lower('a\\\b')` + '`',
    stored: String.raw`lower('a\\b'::text)`,
    literal: String.raw`sql` + '`' + String.raw`lower('a\\\b'::text)` + '`',
  },
  {
    name: 'a string constant holding a backtick',
    type: 'String',
    written: `sql"lower('a\`b')"`,
    stored: "lower('a`b'::text)",
    literal: `sql"lower('a\`b'::text)"`,
  },
  {
    name: 'a CASE the database writes on several lines',
    type: 'String',
    written: "sql`CASE WHEN true THEN 'a' ELSE 'b' END`",
    stored: "\nCASE\n    WHEN true THEN 'a'::text\n    ELSE 'b'::text\nEND",
    literal: "sql`\nCASE\n    WHEN true THEN 'a'::text\n    ELSE 'b'::text\nEND\n`",
  },
] as const;

withTempDir(({ createTempDir }) => {
  describe.each(cases)('a raw SQL default with $name', ({ type, written, stored, literal }) => {
    const db = useDevDatabase();

    it(
      'db migrate names the stored form and how to plan again; following it ends clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeContract(ctx, schema(type, written));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);

        const failed = await runMigrate(ctx);
        const shown = shownOutput(failed);
        expect(failed.exitCode, shown).not.toBe(0);
        expect(withoutContinuationIndent(shown)).toContain(
          `why: The schema check after apply found: mismatch: database/public/Event/column:at/default. The database reads this default back as ${literal}; the contract declares ${written}. ${HEDGE} If they do, write the default as ${literal}.`,
        );

        const advised =
          /write the default as ([\s\S]+?)\. The failed apply changed nothing\.\n→/.exec(
            shown,
          )?.[1];
        const fix =
          /delete `([^`]+)` \(copy any code you wrote in its migration\.ts first\), plan it again with `\S+ migration plan ([^`]+)`, put any code you copied into the migration\.ts it writes, run that migration\.ts with the `node` command `migration plan` prints, and run `\S+ db migrate`/.exec(
            shown,
          );
        expect({
          advised: advised && withoutContinuationIndent(advised),
          folder: fix?.[1],
          planArgs: fix?.[2],
        }).toEqual({
          advised: literal,
          folder: expect.stringMatching(/^migrations\/app\/\w+_initial$/),
          planArgs: '--name initial',
        });
        if (advised === undefined || fix?.[1] === undefined || fix[2] === undefined) return;

        writeContract(ctx, schema(type, advised));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        rmSync(join(ctx.testDir, fix[1]), { recursive: true });
        const planned = await planMigrationAndSelfEmit(ctx, fix[2].split(' '));
        expect(planned.exitCode, shownOutput(planned)).toBe(0);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, shownOutput(applied)).toBe(0);
        const verified = await runDbVerify(ctx);
        expect(verified.exitCode, shownOutput(verified)).toBe(0);
        expect(await storedDefault(db.connectionString)).toBe(stored);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('two pending migrations, the first of which writes the default', () => {
    const db = useDevDatabase();
    const withTag = (literal: string) => `${schema('TimestamptzTemporal', literal)}
model Tag {
  id Int @id
}
`;

    it(
      'db migrate says to plan the last one again; following it ends clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeContract(ctx, schema('TimestamptzTemporal', "sql`now() - interval '1 day'`"));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await planMigrationAndSelfEmit(ctx, ['--name', 'first'])).exitCode).toBe(0);
        const firstHash = storageHash(ctx);
        writeContract(ctx, withTag("sql`now() - interval '1 day'`"));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const second = await planMigrationAndSelfEmit(ctx, [
          '--from',
          firstHash,
          '--name',
          'second',
        ]);
        expect(second.exitCode, shownOutput(second)).toBe(0);

        const failed = await runMigrate(ctx);
        const shown = shownOutput(failed);
        expect(failed.exitCode, shown).not.toBe(0);
        const advised =
          /write the default as ([\s\S]+?)\. The failed apply changed nothing\.\n→/.exec(
            shown,
          )?.[1];
        const fix =
          /delete `([^`]+)` \(copy any code you wrote in its migration\.ts first\), plan it again with `\S+ migration plan ([^`]+)`, put any code you copied into the migration\.ts it writes, run that migration\.ts with the `node` command `migration plan` prints, and run `\S+ db migrate`/.exec(
            shown,
          );
        expect({ advised, folder: fix?.[1], planArgs: fix?.[2] }).toEqual({
          advised: "sql`(now() - '1 day'::interval)`",
          folder: expect.stringMatching(/^migrations\/app\/\w+_second$/),
          planArgs: `--from ${firstHash} --name second`,
        });
        if (advised === undefined || fix?.[1] === undefined || fix[2] === undefined) return;

        writeContract(ctx, withTag(advised));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        rmSync(join(ctx.testDir, fix[1]), { recursive: true });
        const planned = await planMigrationAndSelfEmit(ctx, fix[2].split(' '));
        expect(planned.exitCode, shownOutput(planned)).toBe(0);
        const applied = await runMigrate(ctx);
        expect(applied.exitCode, shownOutput(applied)).toBe(0);
        const verified = await runDbVerify(ctx);
        expect(verified.exitCode, shownOutput(verified)).toBe(0);
        expect(await storedDefault(db.connectionString)).toBe("(now() - '1 day'::interval)");
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db init on a raw SQL default the database stores in its own form', () => {
    const db = useDevDatabase();

    it(
      'shows the stored form in its why',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeContract(ctx, schema('TimestamptzTemporal', "sql`now() - interval '1 day'`"));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const failed = await runDbInit(ctx);
        const shown = shownOutput(failed);
        expect(failed.exitCode, shown).not.toBe(0);
        expect(shown).toContain(
          "why: The schema check after apply found: mismatch: database/public/Event/column:at/default. The database reads this default back as sql`(now() - '1 day'::interval)`",
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update on a raw SQL default the database stores in its own form', () => {
    const db = useDevDatabase();

    it(
      'shows the stored form in its why, and says to change the contract',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeContract(ctx, schema('TimestamptzTemporal', "sql`now() - interval '1 day'`"));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        const failed = await runDbUpdate(ctx);
        const shown = shownOutput(failed);
        expect(failed.exitCode, shown).not.toBe(0);
        expect(shown).toContain(
          "why: The schema check after apply found: mismatch: database/public/Event/column:at/default. The database reads this default back as sql`(now() - '1 day'::interval)`",
        );
        expect(shown).toContain('Change the contract source to resolve the issues listed');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('real drift between two default expressions', () => {
    const db = useDevDatabase();

    it(
      'db verify explains the difference and still offers db update, which fixes it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeContract(ctx, schema('TimestamptzTemporal', "sql`(now() + '1 day'::interval)`"));
        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode).toBe(0);
        expect((await runMigrate(ctx)).exitCode).toBe(0);
        await withClient(db.connectionString, (client) =>
          client.query(
            `ALTER TABLE "Event" ALTER COLUMN "at" SET DEFAULT now() + interval '7 days'`,
          ),
        );

        const drifted = await runDbVerify(ctx);
        const shown = shownOutput(drifted);
        expect(drifted.exitCode, shown).not.toBe(0);
        expect(shown).toContain(
          "The database reads this default back as sql`(now() + '7 days'::interval)`; the contract declares sql`(now() + '1 day'::interval)`.",
        );
        expect(shown).toContain('db update');

        const updated = await runDbUpdate(ctx);
        expect(updated.exitCode, shownOutput(updated)).toBe(0);
        const verified = await runDbVerify(ctx);
        expect(verified.exitCode, shownOutput(verified)).toBe(0);
        expect(await storedDefault(db.connectionString)).toBe("(now() + '1 day'::interval)");
      },
      timeouts.spinUpPpgDev,
    );
  });
});
