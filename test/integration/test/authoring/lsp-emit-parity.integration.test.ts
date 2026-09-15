import { copyFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../../../../packages/1-framework/3-tooling/language-server/src/config-resolution';
import { createProjectArtifacts } from '../../../../packages/1-framework/3-tooling/language-server/src/project-artifacts';
import { startServer } from '../../../../packages/1-framework/3-tooling/language-server/src/start-server';
import { withTempDir } from '../utils/cli-test-helpers';
import { runContractEmit, setupJourney } from '../utils/journey-test-helpers';

const schema = `// use prisma-8

model User {
  id        Int @id @default(autoincrement())
  email     String @unique
  username  String?
  name      String?
  posts     Post[]
  createdAt TimestamptzString @default(now())
  updatedAt temporal.updatedAtString()
}

model Post {
  id        Int @id @default(autoincrement())
  title     String
  content   String?
  author    User @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt TimestamptzString @default(now())
  updatedAt temporal.updatedAtString()
}
`;

const configPath = join(
  import.meta.dirname,
  '../fixtures/cli/cli-test-app/fixtures/lsp-emit-parity/prisma.config.ts',
);

function pullClient() {
  const stdin = new PassThrough();
  const controller = new AbortController();
  const responses = new Map<number, (response: { result?: unknown; error?: unknown }) => void>();
  let buffer = Buffer.alloc(0);
  let id = 0;
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
          const response: { id?: number; result?: unknown; error?: unknown } = JSON.parse(
            buffer.subarray(headerEnd + 4, end).toString(),
          );
          buffer = buffer.subarray(end);
          if (response.id !== undefined) {
            responses.get(response.id)?.(response);
            responses.delete(response.id);
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
    request(method: string, params: object) {
      const requestId = ++id;
      const response = new Promise<{ result?: unknown; error?: unknown }>((resolve) =>
        responses.set(requestId, resolve),
      );
      send({ id: requestId, method, params });
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
  describe('language-server diagnostics with a project-installed interpreter', () => {
    it.each(['name String @map("")', '@@map("")'])(
      'diagnoses an empty mapping in %s and clears it after an edit',
      async (declaration) => {
        const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
        const schemaPath = join(ctx.testDir, 'contract.prisma');
        const uri = pathToFileURL(schemaPath).href;
        let text = `// use prisma-8\nmodel User {\n  id Int @id\n  ${declaration}\n}`;
        writeFileSync(schemaPath, text);
        copyFileSync(configPath, ctx.configPath);
        const client = pullClient();
        try {
          const initialized = await client.request('initialize', {
            processId: null,
            rootUri: pathToFileURL(ctx.testDir).href,
            capabilities: { textDocument: { diagnostic: {} } },
          });
          expect(initialized.error).toBeUndefined();
          client.notify('initialized', {});
          client.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'prisma', version: 1, text },
          });
          const report = await client.request('textDocument/diagnostic', { textDocument: { uri } });
          expect(report.error).toBeUndefined();
          expect(report.result).toEqual({
            kind: 'full',
            items: expect.arrayContaining([
              expect.objectContaining({
                code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
                message: 'Mapped name must not be empty',
              }),
            ]),
          });
          text = text.replace('map("")', 'map("physical_name")');
          client.notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text }],
          });
          const fixed = await client.request('textDocument/diagnostic', { textDocument: { uri } });
          expect(fixed.error).toBeUndefined();
          expect(fixed.result).toEqual({ kind: 'full', items: [] });
        } finally {
          await client.close();
        }
      },
      timeouts.coldTransformImport,
    );

    it.each([
      {
        name: 'init schema',
        text: schema,
        exitCode: 0,
        diagnosticCodes: [],
      },
      {
        name: 'literal defaults and mapped names',
        text: `// use prisma-8
model Widget {
  id Int @id @default(autoincrement())
  label String @default("draft") @map("display_label")
  count Int @default(42)
  enabled Boolean @default(true)
  @@map("widgets")
}`,
        exitCode: 0,
        diagnosticCodes: [],
      },
      {
        name: 'invalid default functions',
        text: schema.replaceAll('autoincrement()', 'unknown()'),
        exitCode: 2,
        diagnosticCodes: ['PSL_INVALID_ATTRIBUTE_SYNTAX', 'PSL_INVALID_ATTRIBUTE_SYNTAX'],
      },
    ])(
      'agrees with emit for $name across the internal/public parser boundary',
      async ({ text, exitCode, diagnosticCodes }) => {
        const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
        const schemaPath = join(ctx.testDir, 'contract.prisma');
        const uri = pathToFileURL(schemaPath).href;
        writeFileSync(schemaPath, text);
        copyFileSync(configPath, ctx.configPath);

        const emitted = await runContractEmit(ctx);
        expect(emitted.exitCode, emitted.stderr).toBe(exitCode);

        const resolution = await resolveConfigInputs(ctx.configPath);
        expect(resolution.interpretation).toBeDefined();
        const onInterpretationError = vi.fn();
        const project = createProjectArtifacts({
          ...resolution,
          onInterpretationError,
          getText: (inputUri) => (inputUri === uri ? text : undefined),
        });
        const document = project.document(uri);
        expect(document).toBeDefined();
        expect(document?.diagnostics).toEqual([]);
        expect(document?.interpretDiagnostics().map((diagnostic) => diagnostic.code)).toEqual(
          diagnosticCodes,
        );
        expect(onInterpretationError).not.toHaveBeenCalled();
      },
      timeouts.coldTransformImport,
    );
  });
});
