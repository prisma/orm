/**
 * The CLI commands, the language server and a scaffolded `migration.ts`, each run as a child
 * process that has no global `Temporal`, read, check and render date and time column defaults, and
 * set no global `Temporal`.
 *
 * Each of them loads `prisma.config.ts`, which loads the Postgres target's control entry. The
 * control entry sets a fallback `Temporal` when it is loaded, and the target's codecs use it.
 *
 * The other journeys run commands in this process, where the vitest setup file has installed a
 * global `Temporal`. Only a child process shows what the control plane does on its own.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { withClient } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { emittedColumns } from '../utils/emitted-columns';
import {
  getLatestMigrationDir,
  type JourneyContext,
  runContractEmit,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  type ChildRun,
  childOutput,
  NO_GLOBAL_TEMPORAL,
  reportedTemporal,
  runNodeWithoutTemporal,
  spawnNodeWithoutTemporal,
} from '../utils/node-without-temporal';

const BIN_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs',
);

const EMIT_SCHEMA = `// use prisma-8

model Event {
  id        Int      @id
  createdAt DateTime @default("2024-01-01T00:00:00Z")
}
`;

const ONE_INSTANT_SCHEMA = `// use prisma-8

model Event {
  id Int      @id
  a  DateTime @default("2024-01-01T00:00:00Z")
  b  DateTime @default("2024-01-01T00:00:00.000Z")
  c  DateTime @default("2024-01-01T01:00:00+01:00")
}
`;

const DEFAULTS_SCHEMA = `// use prisma-8

model Event {
  id        Int            @id
  localAt   Timestamp(3)   @default("2024-01-01 00:00:00")
  instantAt Timestamptz    @default("2024-01-01T00:00:00Z")
  history   Timestamp(3)[] @default(["2024-01-01 00:00:00", "2024-06-30 12:34:56.789"])

  @@map("event")
}
`;

const INFER_SQL = `
CREATE TABLE "event" (
    "id" INTEGER NOT NULL,
    "localAt" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00',

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);
`;

interface MigrationOperation {
  readonly id: string;
  readonly execute: readonly { readonly sql: string }[];
}

function runBin(ctx: JourneyContext, argv: readonly string[]): Promise<ChildRun> {
  return runNodeWithoutTemporal([BIN_PATH, ...argv], { cwd: ctx.testDir });
}

interface LanguageServerResponse {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PublishedDiagnostics {
  readonly uri: string;
  readonly diagnostics: readonly { readonly code?: unknown; readonly message?: unknown }[];
}

function isPublishedDiagnostics(message: LanguageServerResponse): boolean {
  return message.method === 'textDocument/publishDiagnostics';
}

/** `prisma lsp` as a child process with no `Temporal`, spoken to over its standard streams. */
function languageServerWithoutTemporal(ctx: JourneyContext) {
  const child = spawnNodeWithoutTemporal([BIN_PATH, 'lsp', '--stdio'], { cwd: ctx.testDir });
  const responses = new Map<number, (response: LanguageServerResponse) => void>();
  const notifications: LanguageServerResponse[] = [];
  const diagnosticsWaiters: { uri: string; resolve: (value: PublishedDiagnostics) => void }[] = [];
  let received = Buffer.alloc(0);
  let stderr = '';
  let lastId = 0;
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  child.stdout.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    for (;;) {
      const headerEnd = received.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(
        /Content-Length: (\d+)/i.exec(received.subarray(0, headerEnd).toString())?.[1],
      );
      const end = headerEnd + 4 + length;
      if (received.length < end) return;
      const message: LanguageServerResponse = JSON.parse(
        received.subarray(headerEnd + 4, end).toString(),
      );
      received = received.subarray(end);
      if (message.id === undefined) {
        notifications.push(message);
        if (isPublishedDiagnostics(message)) publishedDiagnostics(message.params);
      } else {
        responses.get(message.id)?.(message);
        responses.delete(message.id);
      }
    }
  });
  function publishedDiagnostics(params: unknown): void {
    const report = params as PublishedDiagnostics;
    const waiter = diagnosticsWaiters.findIndex((candidate) => candidate.uri === report.uri);
    if (waiter < 0) return;
    diagnosticsWaiters.splice(waiter, 1)[0]?.resolve(report);
  }
  function send(message: object): void {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  return {
    output: () => JSON.stringify({ notifications, stderr }, null, 2),
    notify: (method: string, params: object) => send({ method, params }),
    nextDiagnostics(uri: string): Promise<PublishedDiagnostics> {
      return new Promise((resolve) => diagnosticsWaiters.push({ uri, resolve }));
    },
    request(method: string, params: object): Promise<LanguageServerResponse> {
      lastId += 1;
      const id = lastId;
      const response = new Promise<LanguageServerResponse>((resolve) => responses.set(id, resolve));
      send({ id, method, params });
      return response;
    },
    exited: new Promise<{ exitCode: number | null } & ReturnType<typeof reportedTemporal>>(
      (resolve) => {
        child.on('close', (exitCode) => resolve({ exitCode, ...reportedTemporal(stderr) }));
      },
    ),
  };
}

function writeSchema(ctx: JourneyContext, schema: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), schema, 'utf-8');
}

async function emitInThisProcess(ctx: JourneyContext, schema: string): Promise<void> {
  writeSchema(ctx, schema);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit\n${emit.stderr}\n${emit.stdout}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey: the control plane in a process with no Temporal', () => {
    describe('contract emit', () => {
      it('the child process has no Temporal before or after a program that uses none', async () => {
        const run = await runNodeWithoutTemporal(['-e', ''], { cwd: createTempDir() });

        expect(run).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
      });

      it(
        'stores a DateTime default written in PSL',
        async () => {
          const ctx = setupJourney({ createTempDir, contractMode: 'psl', connectionString: 'x' });
          writeSchema(ctx, EMIT_SCHEMA);

          const emit = await runBin(ctx, ['contract', 'emit']);

          expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          expect(emittedColumns(ctx.testDir)['createdAt']?.default).toEqual({
            kind: 'literal',
            value: '2024-01-01T00:00:00Z',
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'stores one text for three DateTime defaults written for one instant',
        async () => {
          const ctx = setupJourney({ createTempDir, contractMode: 'psl', connectionString: 'x' });
          writeSchema(ctx, ONE_INSTANT_SCHEMA);

          const emit = await runBin(ctx, ['contract', 'emit']);

          expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const columns = emittedColumns(ctx.testDir);
          expect([columns['a']?.default, columns['b']?.default, columns['c']?.default]).toEqual([
            { kind: 'literal', value: '2024-01-01T00:00:00Z' },
            { kind: 'literal', value: '2024-01-01T00:00:00Z' },
            { kind: 'literal', value: '2024-01-01T00:00:00Z' },
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('db init', () => {
      const db = useDevDatabase();

      it(
        'creates timestamp, timestamptz and timestamp list defaults',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await emitInThisProcess(ctx, DEFAULTS_SCHEMA);

          const init = await runBin(ctx, ['db', 'init']);

          expect(init, childOutput(init)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const defaults = await withClient(db.connectionString, async (client) => {
            await client.query('INSERT INTO "event" ("id") VALUES (1)');
            const result = await client.query<Record<string, string>>(
              `SELECT "localAt"::text AS "localAt",
                      ("instantAt" AT TIME ZONE 'UTC')::text AS "instantAt",
                      "history"::text AS "history"
               FROM "event"`,
            );
            return result.rows;
          });
          expect(defaults).toEqual([
            {
              localAt: '2024-01-01 00:00:00',
              instantAt: '2024-01-01 00:00:00',
              history: '{"2024-01-01 00:00:00","2024-06-30 12:34:56.789"}',
            },
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('node migration.ts', () => {
      const db = useDevDatabase();

      it(
        'writes the operations of a migration that creates date and time defaults',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await emitInThisProcess(ctx, DEFAULTS_SCHEMA);
          const plan = await runMigrationPlan(ctx, ['--name', 'events']);
          expect(plan.exitCode, `migration plan\n${plan.stderr}\n${plan.stdout}`).toBe(0);
          const migrationDir = join(
            ctx.testDir,
            'migrations/app',
            getLatestMigrationDir(ctx) ?? '',
          );
          const opsPath = join(migrationDir, 'ops.json');
          rmSync(opsPath, { force: true });

          const run = await runNodeWithoutTemporal([join(migrationDir, 'migration.ts')], {
            cwd: ctx.testDir,
          });

          expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const ops: readonly MigrationOperation[] = JSON.parse(readFileSync(opsPath, 'utf-8'));
          expect(
            ops.find((op) => op.id === 'table.event')?.execute.map((step) => step.sql.split('\n')),
          ).toEqual([
            [
              'CREATE TABLE "public"."event" (',
              `  "history" timestamp(3)[] DEFAULT ARRAY['2024-01-01T00:00:00', '2024-06-30T12:34:56.789']::timestamp(3)[] NOT NULL,`,
              '  "id" int4 NOT NULL,',
              `  "instantAt" timestamptz DEFAULT '2024-01-01T00:00:00Z'::timestamptz NOT NULL,`,
              `  "localAt" timestamp(3) DEFAULT '2024-01-01T00:00:00'::timestamp(3) NOT NULL,`,
              '  PRIMARY KEY ("id"),',
              '  CONSTRAINT "event_history_elem_not_null_98e8e785" CHECK (array_position("history", NULL) IS NULL)',
              ')',
            ],
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('the language server', () => {
      it(
        'reports no diagnostic for a DateTime default',
        async () => {
          const ctx = setupJourney({ createTempDir, contractMode: 'psl', connectionString: 'x' });
          writeSchema(ctx, EMIT_SCHEMA);
          const uri = pathToFileURL(join(ctx.testDir, 'contract.prisma')).href;
          const server = languageServerWithoutTemporal(ctx);

          const initialized = await server.request('initialize', {
            processId: null,
            rootUri: pathToFileURL(ctx.testDir).href,
            capabilities: {},
          });
          server.notify('initialized', {});
          const cleanPublished = server.nextDiagnostics(uri);
          server.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'prisma', version: 1, text: EMIT_SCHEMA },
          });
          const clean = await cleanPublished;
          const brokenPublished = server.nextDiagnostics(uri);
          server.notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: EMIT_SCHEMA.replace('2024-01-01T00:00:00Z', 'not a date') }],
          });
          const broken = await brokenPublished;
          await server.request('shutdown', {});
          server.notify('exit', {});

          expect(await server.exited).toEqual({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          expect(initialized.error).toBeUndefined();
          expect(clean, server.output()).toEqual({ uri, diagnostics: [] });
          expect(broken, server.output()).toMatchObject({
            uri,
            diagnostics: [expect.objectContaining({ code: 'PSL_INVALID_DEFAULT_LITERAL' })],
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract infer', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(INFER_SQL)),
      });

      it(
        'prints a timestamp default as a literal in canonical form',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });

          const infer = await runBin(ctx, ['contract', 'infer']);

          expect(infer, childOutput(infer)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const field = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')
            .split('\n')
            .find((line) => line.trim().startsWith('localAt'));
          expect(field?.trim().split(/\s+/)).toEqual([
            'localAt',
            'Timestamp(3)',
            '@default("2024-01-01T00:00:00")',
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
