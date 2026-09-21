/**
 * The user-facing journey for the Prisma 7 contract source: a project whose
 * `prisma.config.ts` points `defineConfig` from the Postgres config entry at
 * `prisma7Schema('./schema.prisma')` runs `contract emit`, `db sign`, and
 * `db verify` through the real command family against a database built by the
 * SQL Prisma 7.10.0 generated, with exit 0 and zero findings. `db verify
 * --strict` reports only what Prisma 7 creates for `@ignore` and `@@ignore`
 * constructs, and the column default left behind by the `@default(now())`
 * removed beside `@updatedAt`. A schema with a `view` fails `contract emit` with one diagnostic
 * and writes nothing.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbSign,
  runDbVerify,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_FIXTURES = join(__dirname, '../fixtures/prisma7-source');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');
const MIGRATION_SQL = readFileSync(join(PRISMA7_FIXTURES, 'supported/migration.sql'), 'utf-8');

const VIEW_SCHEMA = `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}

view ActiveUsers {
  id Int
}
`;

function setupPrisma7Project(
  createTempDir: () => string,
  connectionString: string,
  schema: { readonly copyFrom: string } | { readonly text: string },
): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  if ('copyFrom' in schema) {
    copyFileSync(schema.copyFrom, join(testDir, 'schema.prisma'));
  } else {
    writeFileSync(join(testDir, 'schema.prisma'), schema.text, 'utf-8');
  }
  const config = readFileSync(join(JOURNEY_FIXTURES, 'prisma.config.prisma7.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir: testDir };
}

interface SourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId?: string;
  readonly span?: { readonly start: { readonly line: number } };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: Prisma 7 schema as the contract source', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(MIGRATION_SQL)),
    });

    it(
      'contract emit, db sign, and db verify succeed against the database Prisma 7 built',
      async () => {
        const ctx = setupPrisma7Project(createTempDir, db.connectionString, {
          copyFrom: join(PRISMA7_FIXTURES, 'supported-verify/schema.prisma'),
        });

        const emit = await runContractEmit(ctx, ['--json']);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const contractJsonPath = join(ctx.testDir, 'contract.json');
        const contractDtsPath = join(ctx.testDir, 'contract.d.ts');
        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);
        expect(emit.presented?.data).toMatchObject({
          ok: true,
          storageHash: expect.any(String),
          files: { json: expect.any(String), dts: expect.any(String) },
        });

        // The emitted contract carries the rules the interpreter applied, so
        // a rule regression fails here before it fails db verify.
        const contract: unknown = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
        const namespaces = (
          contract as {
            storage: {
              namespaces: Record<
                string,
                {
                  entries: {
                    table: Record<string, unknown>;
                    native_enum?: Record<string, unknown>;
                  };
                }
              >;
            };
          }
        ).storage.namespaces;
        expect(Object.keys(namespaces).sort()).toEqual(['audit', 'public']);
        expect(
          Object.fromEntries(
            Object.entries(namespaces).map(([id, namespace]) => [
              id,
              {
                tables: Object.keys(namespace.entries.table).sort(),
                enums: Object.keys(namespace.entries.native_enum ?? {}).sort(),
              },
            ]),
          ),
        ).toEqual({
          audit: {
            tables: ['Composite', 'CompositeChild', 'Label', '_LabelToPost', 'audit_log'],
            enums: ['AuditAction'],
          },
          public: {
            tables: [
              'Defaults',
              'ListDefaults',
              'NativeTypes',
              'NumberDefaults',
              'Post',
              'Profile',
              'Review',
              'Scalars',
              'Settings',
              'Tag',
              'TemporalDefaults',
              'Timestamps',
              'User',
              '_Favorites',
              '_Follows',
              '_PostToTag',
              'mapped_indexes',
            ],
            enums: ['user_role'],
          },
        });
        const publicTables = namespaces['public']?.entries.table;
        expect(publicTables?.['_PostToTag']).toMatchObject({
          primaryKey: { columns: ['A', 'B'] },
          indexes: [expect.objectContaining({ name: '_PostToTag_B_index' })],
          foreignKeys: [
            expect.objectContaining({ onDelete: 'cascade', onUpdate: 'cascade' }),
            expect.objectContaining({ onDelete: 'cascade', onUpdate: 'cascade' }),
          ],
        });
        expect(publicTables?.['Post']).toMatchObject({
          foreignKeys: expect.arrayContaining([
            expect.objectContaining({
              source: expect.objectContaining({ columns: ['authorId'] }),
              onDelete: 'restrict',
              onUpdate: 'cascade',
            }),
          ]),
        });

        const sign = await runDbSign(ctx, ['--json']);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--json']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
        expect(verify.presented?.data).toMatchObject({
          ok: true,
          mode: 'full',
          schema: { strict: false, warnings: [] },
        });

        const strictVerify = await runDbVerify(ctx, ['--json', '--strict']);
        expect(strictVerify.exitCode, `db verify --strict\n${output(strictVerify)}`).toBe(4);
        const strictResult = strictVerify.presented?.data as {
          readonly schema: { readonly issues: readonly { readonly path: readonly string[] }[] };
          readonly unclaimed: readonly string[];
        };
        expect({
          issues: strictResult.schema.issues.map((issue) => issue.path).sort(),
          unclaimed: strictResult.unclaimed,
        }).toEqual({
          issues: [
            ['database', 'public', 'Post', 'column:legacyOwnerId'],
            ['database', 'public', 'Post', 'foreign-key:legacyOwnerId->public.User(id)'],
            ['database', 'public', 'Timestamps', 'column:updatedAtNow', 'default'],
            ['database', 'public', 'User', 'column:legacy'],
          ],
          unclaimed: ['LegacyThing'],
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'a schema with a view fails contract emit with one diagnostic and writes nothing',
      async () => {
        const ctx = setupPrisma7Project(createTempDir, db.connectionString, { text: VIEW_SCHEMA });

        const terminalRun = await runContractEmit(ctx);
        expect(terminalRun.exitCode).toBe(2);
        expect(stripAnsi(terminalRun.stderr)).toContain(
          '[PSL.PRISMA7_VIEW_UNSUPPORTED] ./schema.prisma:9:1 View "ActiveUsers" is not supported',
        );
        expect(stripAnsi(terminalRun.stderr)).not.toContain('return ok(Contract)');

        const emit = await runContractEmit(ctx, ['--json']);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(2);
        expect(existsSync(join(ctx.testDir, 'contract.json'))).toBe(false);
        expect(existsSync(join(ctx.testDir, 'contract.d.ts'))).toBe(false);

        const terminal = emit.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
        expect(envelope).toMatchObject({
          ok: false,
          error: {
            code: 'CONTRACT.SOURCE_LOAD_FAILED',
            why: 'Prisma 7 schema interpretation failed',
          },
          diagnostics: [
            {
              code: 'PSL.PRISMA7_VIEW_UNSUPPORTED',
              severity: 'error',
              summary: expect.stringContaining(
                './schema.prisma:9:1 View "ActiveUsers" is not supported',
              ),
              nextActions: [],
              where: { path: './schema.prisma', line: 9 },
            },
          ],
        });
        const findings =
          envelope !== undefined && 'diagnostics' in envelope ? envelope.diagnostics : undefined;
        expect(findings?.[0]).not.toHaveProperty('meta');
        // The source's diagnostics ride on the error's meta, one per construct.
        const meta = (
          envelope as { error?: { meta?: { diagnostics?: readonly SourceDiagnostic[] } } }
        ).error?.meta;
        expect(meta?.diagnostics).toEqual([
          expect.objectContaining({
            code: 'PSL.PRISMA7_VIEW_UNSUPPORTED',
            message: expect.stringContaining('View "ActiveUsers" is not supported'),
            sourceId: './schema.prisma',
            span: expect.objectContaining({ start: expect.objectContaining({ line: 9 }) }),
          }),
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
