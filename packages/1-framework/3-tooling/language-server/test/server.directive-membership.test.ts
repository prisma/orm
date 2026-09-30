import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  FoldingRangeRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer } from '../src/server';

vi.mock('@internal/config-loader', async (original) => ({
  ...(await original<typeof import('@internal/config-loader')>()),
  findNearestConfigPathForFile: async (path: string) => join(dirname(path), 'prisma.config.ts'),
}));

vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: async (
    configPath: string,
    readText: (uri: string) => string | undefined,
  ) => {
    const schemaInputConfig = {
      contract: { source: { format: 'psl', inputs: [join(dirname(configPath), '*.prisma')] } },
    };
    return {
      schemaInputConfig,
      inputs: await resolveSchemaInputs(schemaInputConfig, readText),
      controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
    };
  },
}));

const cleanups: (() => void | Promise<void>)[] = [];
const siblingText = '// use prisma-8\nmodel User {\n id Int\n}\n';
const marked = `${siblingText}\nmodel User {\n id Int\n}\n`;
const unmarked = marked.replace('// use prisma-8\n', '');
const duplicate = [expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' })];

async function harness(pull: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'directive-membership-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const memberPath = join(dir, 'a.prisma');
  const siblingPath = join(dir, 'b.prisma');
  const outsiderPath = join(dir, 'outsider.prisma');
  await Promise.all([
    writeFile(memberPath, marked),
    writeFile(siblingPath, siblingText),
    writeFile(outsiderPath, unmarked),
  ]);
  const member = pathToFileURL(memberPath).toString();
  const sibling = pathToFileURL(siblingPath).toString();
  const outsider = pathToFileURL(outsiderPath).toString();
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(incoming),
    new StreamMessageWriter(outgoing),
  );
  const client = createConnection(
    new StreamMessageReader(outgoing),
    new StreamMessageWriter(incoming),
  );
  const publications: PublishDiagnosticsParams[] = [];
  client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    publications.push(params);
  });
  const server = createServer(connection);
  client.listen();
  cleanups.push(() => {
    server.dispose();
    client.dispose();
    incoming.destroy();
    outgoing.destroy();
  });
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: null,
    capabilities: pull ? { textDocument: { diagnostic: { relatedDocumentSupport: true } } } : {},
  });
  return {
    member,
    sibling,
    outsider,
    publications,
    server,
    open: (uri: string, text: string) =>
      client.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, text, languageId: 'prisma', version: 1 },
      }),
    change: (uri: string, text: string, version: number) =>
      client.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      }),
    read: (uri: string) =>
      client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri } }),
    sync: (uri: string) => client.sendRequest(FoldingRangeRequest.type, { textDocument: { uri } }),
    schemaPublications: () => publications.filter(({ uri }) => uri.endsWith('.prisma')),
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

describe('live directive membership', { timeout: timeouts.databaseOperation }, () => {
  it.each([false, true])(
    'clears push diagnostics and recomputes siblings on removal and restoration (alias=%s)',
    async (alias) => {
      const h = await harness(false);
      const openedUri = alias ? h.member.replace('a.prisma', '%61.prisma') : h.member;
      await h.open(openedUri, marked);
      await vi.waitFor(() =>
        expect(h.schemaPublications()).toEqual([
          { uri: h.member, diagnostics: duplicate },
          { uri: h.sibling, diagnostics: duplicate },
        ]),
      );
      h.publications.length = 0;
      await h.change(openedUri, unmarked, 2);
      await vi.waitFor(() =>
        expect(h.schemaPublications()).toEqual([
          { uri: h.sibling, diagnostics: [] },
          { uri: h.member, diagnostics: [] },
        ]),
      );
      expect(h.server.getDocumentAst(openedUri)).toBeUndefined();
      h.publications.length = 0;
      await h.change(openedUri, marked, 3);
      await vi.waitFor(() =>
        expect(h.schemaPublications()).toEqual([
          { uri: h.member, diagnostics: duplicate },
          { uri: h.sibling, diagnostics: duplicate },
        ]),
      );
      expect(h.server.getDocumentAst(openedUri)).toBeDefined();
    },
  );

  it('does not publish the project for an unrelated never-member document', async () => {
    const h = await harness(false);
    await h.open(h.member, marked);
    await vi.waitFor(() => expect(h.schemaPublications()).toHaveLength(2));
    h.publications.length = 0;
    await h.open(h.outsider, unmarked);
    await h.sync(h.outsider);
    await h.change(h.outsider, `${unmarked}\n`, 2);
    await h.sync(h.outsider);
    expect(h.schemaPublications()).toEqual([]);
    expect(h.server.getDocumentAst(h.outsider)).toBeUndefined();
  });

  it('returns cleared related pull reports after removal without schema pushes', async () => {
    const h = await harness(true);
    await h.open(h.member, marked);
    expect(await h.read(h.member)).toEqual({
      kind: 'full',
      items: duplicate,
      relatedDocuments: { [h.sibling]: { kind: 'full', items: duplicate } },
    });
    await h.change(h.member, unmarked, 2);
    expect(await h.read(h.member)).toEqual({
      kind: 'full',
      items: [],
      relatedDocuments: { [h.sibling]: { kind: 'full', items: [] } },
    });
    await h.change(h.member, marked, 3);
    expect(await h.read(h.member)).toEqual({
      kind: 'full',
      items: duplicate,
      relatedDocuments: { [h.sibling]: { kind: 'full', items: duplicate } },
    });
    expect(h.schemaPublications()).toEqual([]);
  });
});
