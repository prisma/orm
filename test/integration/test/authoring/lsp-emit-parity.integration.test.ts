import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { expandContractInputs, loadConfig } from '@internal/config-loader';
import { createControlStack } from '@internal/framework-components/control';
import { timeouts } from '@repo/test-utils';
import { join, relative } from 'pathe';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../../../../packages/1-framework/3-tooling/language-server/src/config-resolution';
import type { LspDiagnostic } from '../../../../packages/1-framework/3-tooling/language-server/src/diagnostic-mapping';
import { DocumentStore } from '../../../../packages/1-framework/3-tooling/language-server/src/document-store';
import { ProjectArtifacts } from '../../../../packages/1-framework/3-tooling/language-server/src/project-artifacts';
import { startServer } from '../../../../packages/1-framework/3-tooling/language-server/src/start-server';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  engineError,
  type JourneyContext,
  runContractEmit,
  setupJourney,
} from '../utils/journey-test-helpers';

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
const multiFileConfigPath = join(
  import.meta.dirname,
  '../fixtures/cli/cli-test-app/fixtures/lsp-emit-parity-multi-file/prisma.config.ts',
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
            capabilities: { textDocument: { diagnostic: { relatedDocumentSupport: true } } },
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

        const onInterpretationError = vi.fn();
        const documents = new DocumentStore();
        const readText = (readUri: string): string | undefined => documents.text(readUri);
        const resolution = await resolveConfigInputs(ctx.configPath, readText);
        expect(resolution.interpretation).toBeDefined();
        documents.open({ uri, languageId: 'prisma', version: 1, text });
        const project = new ProjectArtifacts({
          ...resolution,
          onInterpretationError,
          readSnapshot: documents.readSnapshot,
        });
        const document = project.document(uri);
        expect(document).toBeDefined();
        expect(document?.parse().diagnostics).toEqual([]);
        expect(project.diagnostics(uri).map((diagnostic) => diagnostic.code)).toEqual(
          diagnosticCodes,
        );
        expect(onInterpretationError).not.toHaveBeenCalled();
      },
      timeouts.coldTransformImport,
    );
  });

  describe('language-server diagnostics agree with contract emit across multiple files', () => {
    const directive = '// use prisma-8\n';

    const userSchema = `${directive}model User {
  id Int @id
  posts Post[]
}

namespace billing {
  model Account {
    id Int @id
  }
}
`;
    const validPostSchema = `${directive}model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
}
`;
    const invalidPostSchema = `${directive}model Post {
  id Int @id
  authorId Int
  author User @relation(fields: [authorId], references: [id])
  slug String @map("")
}
`;
    const extraNamespaceSchema = `${directive}namespace billing {
  model Invoice {
    id Int @id
  }
}
`;
    const draftSchema = 'model Draft {\n  id Int @id\n}\n';

    function multiFileProject(
      createTempDir: () => string,
      postSchema: string,
    ): JourneyContext & { readonly paths: Record<'user' | 'post' | 'extra' | 'draft', string> } {
      const testDir = createTempDir();
      writeProjectManifest(testDir);
      const configPath = join(testDir, 'prisma.config.ts');
      copyFileSync(multiFileConfigPath, configPath);
      const paths = {
        user: join(testDir, 'user.prisma'),
        post: join(testDir, 'post.prisma'),
        extra: join(testDir, 'extra-namespace.prisma'),
        draft: join(testDir, 'draft.prisma'),
      };
      writeFileSync(paths.user, userSchema);
      writeFileSync(paths.post, postSchema);
      writeFileSync(paths.extra, extraNamespaceSchema);
      writeFileSync(paths.draft, draftSchema);
      return { testDir, configPath, outputDir: join(testDir, 'output'), paths };
    }

    async function lspProjectFor(configPath: string) {
      const documents = new DocumentStore();
      const readText = (uri: string): string | undefined => documents.text(uri);
      const resolution = await resolveConfigInputs(configPath, readText);
      expect(resolution.interpretation).toBeDefined();
      const onInterpretationError = vi.fn();
      const project = new ProjectArtifacts({
        ...resolution,
        onInterpretationError,
        readSnapshot: documents.readSnapshot,
      });
      return { project, onInterpretationError };
    }

    function diagnosticsFor(
      project: Awaited<ReturnType<typeof lspProjectFor>>['project'],
      uri: string,
    ): readonly LspDiagnostic[] {
      const document = project.document(uri);
      expect(document, `Loaded member ${uri}`).toBeDefined();
      if (document === undefined) throw new Error(`Missing member ${uri}`);
      return project.diagnostics(uri);
    }

    async function emitDiagnosticsFor(configPath: string) {
      const config = (await loadConfig(configPath)).assertOk().config;
      const contract = config.contract;
      if (contract === undefined) throw new Error('Missing contract configuration');
      const stack = createControlStack(config);
      const warnings: ContractSourceDiagnostic[] = [];
      const result = await contract.source.load({
        composedExtensions: stack.extensions.map((extension) => extension.id),
        composedExtensionContracts: stack.extensionContracts,
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        dataTypeLookup: stack.dataTypeLookup,
        controlMutationDefaults: stack.controlMutationDefaults,
        resolvedInputs: await expandContractInputs(contract.source.inputs),
        capabilities: stack.capabilities,
        reportWarning: (diagnostic) => warnings.push({ ...diagnostic, severity: 'warning' }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected source interpretation to fail');
      expect(result.failure.summary).toBe('PSL to SQL contract interpretation failed');
      return [...warnings, ...result.failure.diagnostics];
    }

    it(
      'resolves the cross-file relation and the namespace reopened across files, and excludes the directive-less member, on both surfaces',
      async () => {
        const ctx = multiFileProject(createTempDir, validPostSchema);

        const emitted = await runContractEmit(ctx);
        expect(emitted.exitCode, emitted.stderr).toBe(0);
        const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')) as {
          readonly domain: { readonly namespaces: Record<string, { readonly models?: object }> };
        };
        expect(Object.keys(contract.domain.namespaces['public']?.models ?? {}).sort()).toEqual([
          'Post',
          'User',
        ]);
        expect(Object.keys(contract.domain.namespaces['billing']?.models ?? {}).sort()).toEqual([
          'Account',
          'Invoice',
        ]);

        const { project, onInterpretationError } = await lspProjectFor(ctx.configPath);
        for (const uri of [ctx.paths.user, ctx.paths.post, ctx.paths.extra].map((p) =>
          pathToFileURL(p).toString(),
        )) {
          expect(diagnosticsFor(project, uri)).toEqual([]);
        }
        expect(onInterpretationError).not.toHaveBeenCalled();
        const models = Object.keys(project.symbolTable().topLevel.models);
        expect(models.sort()).toEqual(['Post', 'User']);

        const namespaceModels = Object.values(contract.domain.namespaces).flatMap((namespace) =>
          Object.keys(namespace.models ?? {}),
        );
        expect(namespaceModels).not.toContain('Draft');
        const draftUri = pathToFileURL(ctx.paths.draft).toString();
        expect(project.document(draftUri)).toBeUndefined();
        expect(models).not.toContain('Draft');
      },
      timeouts.coldTransformImport,
    );

    it(
      'attributes an invalid mapping in one member to that member only, matching emit and the LSP',
      async () => {
        const ctx = multiFileProject(createTempDir, invalidPostSchema);

        const emitted = await runContractEmit(ctx, ['--json']);
        expect(emitted.exitCode, emitted.stderr).toBe(2);
        expect(engineError(emitted)).toMatchObject({
          code: 'CONTRACT.SOURCE_LOAD_FAILED',
          why: 'PSL to SQL contract interpretation failed',
        });
        const sourceDiagnostics = await emitDiagnosticsFor(ctx.configPath);
        const emitDiagnostics = sourceDiagnostics.map((diagnostic) => {
          const span = diagnostic.span;
          expect(span).toBeDefined();
          if (span === undefined) throw new Error('Expected a located source diagnostic');
          return {
            sourceId: relative(ctx.testDir, diagnostic.sourceId),
            code: diagnostic.code,
            message: diagnostic.message,
            severity: diagnostic.severity ?? 'error',
            range: {
              start: { line: span.start.line - 1, character: span.start.column - 1 },
              end: { line: span.end.line - 1, character: span.end.column - 1 },
            },
          };
        });

        const { project, onInterpretationError } = await lspProjectFor(ctx.configPath);
        const lspDiagnostics = [ctx.paths.user, ctx.paths.post, ctx.paths.extra].flatMap((path) => {
          const uri = pathToFileURL(path).href;
          return diagnosticsFor(project, uri).map((diagnostic) => ({
            sourceId: relative(ctx.testDir, fileURLToPath(uri)),
            code: diagnostic.code,
            message: diagnostic.message,
            severity: { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' }[
              diagnostic.severity
            ],
            range: diagnostic.range,
          }));
        });
        function byFile<T extends { readonly sourceId: string }>(diagnostics: readonly T[]) {
          const grouped: Record<string, T[]> = {
            'user.prisma': [],
            'post.prisma': [],
            'extra-namespace.prisma': [],
          };
          for (const diagnostic of [...diagnostics].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          )) {
            const group = grouped[diagnostic.sourceId] ?? [];
            group.push(diagnostic);
            grouped[diagnostic.sourceId] = group;
          }
          return grouped;
        }
        expect(byFile(lspDiagnostics)).toEqual(byFile(emitDiagnostics));
        expect(byFile(emitDiagnostics)).toEqual({
          'user.prisma': [],
          'extra-namespace.prisma': [],
          'post.prisma': [
            {
              sourceId: 'post.prisma',
              code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
              message: 'Mapped name must not be empty',
              severity: 'error',
              range: {
                start: { line: 5, character: 14 },
                end: { line: 5, character: 22 },
              },
            },
          ],
        });
        expect(onInterpretationError).not.toHaveBeenCalled();
        expect(project.document(pathToFileURL(ctx.paths.draft).href)).toBeUndefined();
      },
      timeouts.coldTransformImport,
    );
  });
});
