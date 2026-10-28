import { copyFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { startServer } from '@internal/language-server';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { setupJourney } from '../utils/journey-test-helpers';

const configPath = join(
  import.meta.dirname,
  '../fixtures/cli/cli-test-app/fixtures/lsp-workspace-packages/prisma.config.ts',
);

interface LspResponse {
  readonly result?: unknown;
  readonly error?: unknown;
}

function lspClient() {
  const stdin = new PassThrough();
  const controller = new AbortController();
  const pending = new Map<number, (response: LspResponse) => void>();
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  const running = startServer({
    stdin,
    signal: controller.signal,
    stderr: { write: () => {} },
    stdout: {
      write(chunk) {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        while (true) {
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) return;
          const length = Number(
            /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1],
          );
          const end = headerEnd + 4 + length;
          if (buffer.length < end) return;
          const message: LspResponse & { readonly id?: number } = JSON.parse(
            buffer.subarray(headerEnd + 4, end).toString(),
          );
          buffer = buffer.subarray(end);
          if (message.id !== undefined) {
            pending.get(message.id)?.(message);
            pending.delete(message.id);
          }
        }
      },
    },
  });
  function send(message: object) {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  return {
    notify: (method: string, params: object) => send({ method, params }),
    request(method: string, params: object): Promise<LspResponse> {
      const id = ++nextId;
      const response = new Promise<LspResponse>((resolve) => pending.set(id, resolve));
      send({ id, method, params });
      return response;
    },
    async close() {
      controller.abort();
      stdin.end();
      await running;
    },
  };
}

withTempDir(({ createTempDir }) => {
  describe('language-server completion in a Postgres project', () => {
    it(
      "offers a sql literal for a policy block's using",
      async () => {
        const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
        copyFileSync(configPath, ctx.configPath);
        const schemaPath = join(ctx.testDir, 'contract.prisma');
        const uri = pathToFileURL(schemaPath).href;
        const lines = [
          '// use prisma-8',
          'model Post {',
          '  id Int @id',
          '}',
          'policy_select read_own {',
          '  using = ',
          '}',
        ];
        const text = lines.join('\n');
        writeFileSync(schemaPath, text);
        const client = lspClient();
        try {
          const initialized = await client.request('initialize', {
            processId: null,
            rootUri: pathToFileURL(ctx.testDir).href,
            capabilities: {},
          });
          expect(initialized.error).toBeUndefined();
          client.notify('initialized', {});
          client.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'prisma', version: 1, text },
          });

          const completion = await client.request('textDocument/completion', {
            textDocument: { uri },
            position: { line: lines.indexOf('  using = '), character: '  using = '.length },
          });

          expect(completion.error).toBeUndefined();
          expect(completion.result).toEqual([expect.objectContaining({ label: 'sql' })]);
        } finally {
          await client.close();
        }
      },
      timeouts.coldTransformImport,
    );

    it(
      'offers in @default only the tags whose type the column type is or casts from',
      async () => {
        const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
        copyFileSync(configPath, ctx.configPath);
        const schemaPath = join(ctx.testDir, 'contract.prisma');
        const uri = pathToFileURL(schemaPath).href;
        const lines = [
          '// use prisma-8',
          'types {',
          '  Day = Date',
          '}',
          'model Post {',
          '  id    Int   @id',
          '  when  Day   @default()',
          '  day   Date  @default()',
          '  meta  Jsonb @default()',
          '  bytes Bytes @default()',
          '}',
        ];
        const text = lines.join('\n');
        writeFileSync(schemaPath, text);
        const allTags = new Set([
          'sql',
          'json',
          'date',
          'time',
          'timetz',
          'timestamp',
          'timestamptz',
          'interval',
          'bytea',
        ]);
        const client = lspClient();
        try {
          const initialized = await client.request('initialize', {
            processId: null,
            rootUri: pathToFileURL(ctx.testDir).href,
            capabilities: {},
          });
          expect(initialized.error).toBeUndefined();
          client.notify('initialized', {});
          client.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'prisma', version: 1, text },
          });

          const tagsOffered = async (field: string) => {
            const line = lines.findIndex((entry) => entry.startsWith(`  ${field} `));
            const completion = await client.request('textDocument/completion', {
              textDocument: { uri },
              position: { line, character: (lines[line] ?? '').indexOf('@default(') + 9 },
            });
            expect(completion.error).toBeUndefined();
            const items = Array.isArray(completion.result) ? completion.result : [];
            return items
              .map((item: { readonly label: string }) => item.label)
              .filter((label: string) => allTags.has(label));
          };

          expect({
            when: await tagsOffered('when'),
            day: await tagsOffered('day'),
            meta: await tagsOffered('meta'),
            bytes: await tagsOffered('bytes'),
          }).toEqual({
            when: ['sql', 'date'],
            day: ['sql', 'date'],
            meta: ['sql', 'json'],
            bytes: ['sql', 'bytea'],
          });
        } finally {
          await client.close();
        }
      },
      timeouts.coldTransformImport,
    );
  });
});
