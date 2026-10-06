/**
 * Journey: a `Bytes` default is stored in the contract as base64, written in PSL as base64 or as
 * PostgreSQL hex. PostgreSQL prints the default back in hex, and the schema check reads that hex as
 * the same bytes, so `db init` and `db migrate` succeed and strict `db verify` is clean.
 * `contract infer` prints a `bytea` default as a base64 literal.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { emittedColumns } from '../utils/emitted-columns';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbInit,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const HELLO = 'aGVsbG8=';

function schema(defaults: boolean): string {
  const withDefault = (attribute: string) => (defaults ? ` ${attribute}` : '');
  return `// use prisma-8

model Doc {
  id    Int     @id
  blob  Bytes${withDefault('@default("aGVsbG8=")')}
  blobs Bytes[]${withDefault('@default(["aGVsbG8="])')}
  hex   Bytes${withDefault('@default("\\\\x68656c6c6f")')}

  @@map("doc")
}
`;
}

const STORED_DEFAULTS = {
  blob: { kind: 'literal', value: HELLO },
  blobs: { kind: 'literal', value: [HELLO] },
  hex: { kind: 'literal', value: HELLO },
};

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly unknown[] };
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

function defaultsOf(ctx: JourneyContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(emittedColumns(ctx.testDir)).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

function storageHash(ctx: JourneyContext): string {
  const contractJson: { readonly storage: { readonly storageHash: string } } = JSON.parse(
    readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'),
  );
  return contractJson.storage.storageHash;
}

async function schemaIssues(ctx: JourneyContext): Promise<readonly unknown[]> {
  const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
  return parseJsonOutput<SchemaVerifyResult>(verify).schema.issues;
}

/** The bytes each default stores, read as UTF-8 text from a row inserted with only its id. */
async function storedText(connectionString: string): Promise<unknown> {
  return withClient(connectionString, async (client) => {
    await client.query('INSERT INTO "doc" ("id") VALUES (1)');
    const { rows } = await client.query(
      `SELECT convert_from("blob", 'UTF8') AS "blob",
              ARRAY(SELECT convert_from(element, 'UTF8') FROM unnest("blobs") AS element) AS "blobs",
              convert_from("hex", 'UTF8') AS "hex"
         FROM "doc"`,
    );
    return rows;
  });
}

const STORED_TEXT = [{ blob: 'hello', blobs: ['hello'], hex: 'hello' }];

withTempDir(({ createTempDir }) => {
  describe('Journey: bytea defaults created by db init', () => {
    const db = useDevDatabase();

    it(
      'stores base64, creates the defaults, verifies clean, and inserts the bytes',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), schema(true), 'utf-8');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(defaultsOf(ctx)).toEqual(STORED_DEFAULTS);

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);
        expect(await schemaIssues(ctx)).toEqual([]);

        expect(await storedText(db.connectionString)).toEqual(STORED_TEXT);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: bytea defaults a migration adds to existing columns', () => {
    const db = useDevDatabase();

    it(
      'plans and applies the defaults, verifies clean, and inserts the bytes',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), schema(false), 'utf-8');
        const emitColumns = await runContractEmit(ctx);
        expect(emitColumns.exitCode, `contract emit\n${output(emitColumns)}`).toBe(0);
        const planColumns = await runMigrationPlan(ctx, ['--name', 'columns']);
        expect(planColumns.exitCode, `migration plan\n${output(planColumns)}`).toBe(0);
        const migrateColumns = await runMigrate(ctx);
        expect(migrateColumns.exitCode, `db migrate\n${output(migrateColumns)}`).toBe(0);
        const columnsHash = storageHash(ctx);

        writeFileSync(join(ctx.testDir, 'contract.prisma'), schema(true), 'utf-8');
        const emitDefaults = await runContractEmit(ctx);
        expect(emitDefaults.exitCode, `contract emit\n${output(emitDefaults)}`).toBe(0);
        expect(defaultsOf(ctx)).toEqual(STORED_DEFAULTS);
        const planDefaults = await runMigrationPlan(ctx, [
          '--name',
          'defaults',
          '--from',
          columnsHash,
        ]);
        expect(planDefaults.exitCode, `migration plan\n${output(planDefaults)}`).toBe(0);
        const migrateDefaults = await runMigrate(ctx);
        expect(migrateDefaults.exitCode, `db migrate\n${output(migrateDefaults)}`).toBe(0);

        expect(await schemaIssues(ctx)).toEqual([]);
        expect(await storedText(db.connectionString)).toEqual(STORED_TEXT);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: contract infer on a bytea default', () => {
    const db = useDevDatabase({
      onReady: (connectionString) =>
        withClient(connectionString, (client) =>
          client.query(
            `CREATE TABLE "doc" (
               "id" int4 PRIMARY KEY,
               "blob" bytea NOT NULL DEFAULT '\\x68656c6c6f',
               "blobs" bytea[] NOT NULL DEFAULT ARRAY['\\x68656c6c6f'::bytea]
             )`,
          ),
        ),
    });

    it(
      'prints base64 literals, and the inferred schema emits and verifies clean',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
        const printed = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')
          .split('\n')
          .filter((line) => line.includes('@default('))
          .map((line) => line.trim().split(/\s+/).join(' '));
        expect(printed).toEqual([
          'blob Bytes @default("aGVsbG8=")',
          'blobs Bytes[] @default(["aGVsbG8="]) @noCheck(elementNotNull)',
        ]);

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(defaultsOf(ctx)).toEqual({
          blob: { kind: 'literal', value: HELLO },
          blobs: { kind: 'literal', value: [HELLO] },
        });
        expect(await schemaIssues(ctx)).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
