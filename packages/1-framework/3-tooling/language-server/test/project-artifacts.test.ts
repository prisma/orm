import { pathToFileURL } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import { buildSymbolTable } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { notOk, ok } from '@internal/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ProjectInterpretation } from '../src/config-resolution';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import type { PipelineInputs } from '../src/pipeline';
import { createProjectArtifacts, type ProjectArtifacts } from '../src/project-artifacts';
import { canonicalFileIdentity, resolveSchemaInputs } from '../src/schema-inputs';

const pipelineMock = vi.hoisted(() => ({
  runPipeline: vi.fn<typeof import('../src/pipeline')['runPipeline']>(),
}));

// Pass-through spy on the parse seam so tests can count parses.
vi.mock('../src/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pipeline')>();
  pipelineMock.runPipeline.mockImplementation(actual.runPipeline);
  return { ...actual, runPipeline: pipelineMock.runPipeline };
});

afterEach(() => {
  pipelineMock.runPipeline.mockClear();
});

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const inputs = resolveSchemaInputs({
  contract: { source: { format: 'psl', inputs: ['/abs/schema.psl'] } },
});

const controlStack: PipelineInputs = {
  scalarTypes: ['String', 'Int', 'Boolean', 'DateTime'],
  pslBlockDescriptors: {},
};

const directive = '// use prisma-8\n';
const cleanSource = `${directive}model User {\n  id Int @id\n}\n`;
const twoModelSource = `${directive}model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n`;
const unmarkedSource = 'model Stray {\n  id Int @id\n}\n';

function mirroredDocument(
  texts: ReadonlyMap<string, string>,
  uri: string,
): TextDocument | undefined {
  for (const [openedUri, text] of texts) {
    if (canonicalFileIdentity(openedUri) === canonicalFileIdentity(uri)) {
      return TextDocument.create(openedUri, 'prisma', 1, text);
    }
  }
  return undefined;
}

function projectWithMirror(interpretation?: ProjectInterpretation): {
  readonly texts: Map<string, string>;
  readonly store: ProjectArtifacts;
  readonly onInterpretationError: ReturnType<typeof vi.fn>;
} {
  const onInterpretationError = vi.fn();
  const texts = new Map<string, string>();
  const store = createProjectArtifacts({
    inputs,
    controlStack,
    onInterpretationError,
    getDocument: (uri) => mirroredDocument(texts, uri),
    ...(interpretation === undefined ? {} : { interpretation }),
  });
  return { texts, store, onInterpretationError };
}

const interpretContext = { composedExtensions: [] } as unknown as ContractSourceContext;

function interpretationDouble(interpret: PslInterpretCapable['interpret']): {
  readonly interpretation: ProjectInterpretation;
  readonly spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(interpret);
  const source = {
    format: 'psl',
    load: async () => ok({} as never),
    interpret: spy,
  } as unknown as PslInterpretCapable;
  return { interpretation: { source, context: interpretContext }, spy };
}

describe('createProjectArtifacts', () => {
  it('owns symbol diagnostics at project level in configured order with source filenames', () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new Map([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const store = createProjectArtifacts({
      inputs: resolveSchemaInputs({
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      }),
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
      interpretation,
    });
    const sibling = store.document(siblingUri)!;
    expect(sibling.diagnostics).toEqual([]);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User', 'Post']);
    const first = store.document(schemaUri)!;
    expect(store.symbolTable().topLevel.models['User']?.node.syntax.root()).toBe(
      first.document.syntax,
    );
    expect(first.diagnostics).toEqual([]);
    expect(sibling.diagnostics).toEqual([]);
    const symbolDiagnostics = store.symbolDiagnostics();
    expect(store.symbolDiagnostics()).toBe(symbolDiagnostics);
    expect(symbolDiagnostics).toEqual([
      {
        filename: siblingUri,
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
      },
    ]);
    first.interpretDiagnostics();
    expect(spy.mock.calls[0]?.[0].symbolTable).toBe(store.symbolTable());
    texts.set(siblingUri, `${directive}model Other { id Int }`);
    store.documentChanged(siblingUri);
    first.interpretDiagnostics();
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User', 'Other']);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(store.document(siblingUri)?.diagnostics).toEqual([]);
    expect(store.symbolDiagnostics()).toEqual([]);
    texts.set(siblingUri, twoModelSource);
    store.documentChanged(siblingUri);
    expect(store.symbolDiagnostics()).toEqual(symbolDiagnostics);
    texts.delete(schemaUri);
    store.documentClosed(schemaUri);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User', 'Post']);
    expect(store.symbolDiagnostics()).toEqual([]);
    expect(() => store.sources.sourceFileFor(first.document.syntax)).toThrow(/No SourceFile/);
  });
  it('parses the mirrored text on first read', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    expect(artifacts?.document).toBeDefined();
    expect(artifacts?.sourceFile).toBeDefined();
    expect(artifacts?.diagnostics).toEqual([]);
    expect(artifacts).not.toHaveProperty('sources');
  });

  it('reloads edited live inputs whose URI spelling differs from configured input spelling', () => {
    const liveUri = 'file:///abs/%73chema.psl';
    const { texts, store } = projectWithMirror();
    texts.set(liveUri, cleanSource);
    const first = store.document(schemaUri)!;
    expect(first.sourceFile.filename).toBe(liveUri);
    expect(store.symbolTable().topLevel.models['User']?.node.syntax.root()).toBe(
      first.document.syntax,
    );
    texts.set(liveUri, twoModelSource);
    store.documentChanged(schemaUri);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User', 'Post']);
    expect(store.document(schemaUri)).toBe(store.document(liveUri));
    expect(() => store.sources.sourceFileFor(first.document.syntax)).toThrow(/No SourceFile/);
    texts.delete(liveUri);
    store.documentClosed(schemaUri);
    expect(store.document(schemaUri)).toBeUndefined();
    texts.set(schemaUri, cleanSource);
    expect(store.document(schemaUri)?.sourceFile.filename).toBe(schemaUri);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User']);
  });

  it('returns the same artifacts for repeated reads without an intervening event', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    texts.set(schemaUri, twoModelSource);

    expect(store.document(schemaUri)).toBe(first);
  });

  it('reflects the latest mirrored text on the read after documentChanged', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    texts.set(schemaUri, twoModelSource);
    store.documentChanged(schemaUri);

    const second = store.document(schemaUri);
    expect(second?.document).not.toBe(first?.document);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(
      expect.arrayContaining(['User', 'Post']),
    );
  });

  it('returns undefined for documents without mirrored text', () => {
    const { store } = projectWithMirror();
    expect(store.document(schemaUri)).toBeUndefined();
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('returns undefined for documents that are not configured inputs', () => {
    const { texts, store } = projectWithMirror();
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    texts.set(otherUri, cleanSource);

    expect(store.document(otherUri)).toBeUndefined();
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('returns undefined for a configured input without the prisma-8 directive', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, unmarkedSource);

    expect(store.document(schemaUri)).toBeUndefined();
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('serves a configured input again once an edit adds the directive', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, unmarkedSource);
    expect(store.document(schemaUri)).toBeUndefined();

    texts.set(schemaUri, `${directive}${unmarkedSource}`);
    store.documentChanged(schemaUri);

    expect(store.document(schemaUri)?.document).toBeDefined();
  });

  it('excludes an unmarked sibling input from the symbol table', () => {
    const schema2Uri = pathToFileURL('/abs/schema2.psl').toString();
    const twoInputs = resolveSchemaInputs({
      contract: {
        source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/schema2.psl'] },
      },
    });
    const texts = new Map<string, string>();
    const store = createProjectArtifacts({
      inputs: twoInputs,
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
    });
    texts.set(schemaUri, unmarkedSource);
    texts.set(schema2Uri, cleanSource);

    expect(store.document(schemaUri)).toBeUndefined();
    const models = Object.keys(store.symbolTable().topLevel.models);
    expect(models).toContain('User');
    expect(models).not.toContain('Stray');
  });

  it('reading the symbol table on a fresh store parses the open configured input once', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    expect(Object.keys(store.symbolTable().topLevel.models)).toContain('User');
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('a document read after a symbol-table read reuses the same parse', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    store.symbolTable();
    expect(store.document(schemaUri)?.document).toBeDefined();
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the symbol table from a sibling input after the contributing document closes', () => {
    const schema2Uri = pathToFileURL('/abs/schema2.psl').toString();
    const twoInputs = resolveSchemaInputs({
      contract: {
        source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/schema2.psl'] },
      },
    });
    const texts = new Map<string, string>();
    const store = createProjectArtifacts({
      inputs: twoInputs,
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
    });
    texts.set(schemaUri, cleanSource);
    texts.set(schema2Uri, twoModelSource);
    store.document(schemaUri);
    store.document(schema2Uri);

    texts.delete(schema2Uri);
    store.documentClosed(schema2Uri);

    expect(Object.keys(store.symbolTable().topLevel.models)).toContain('User');
  });

  it('owns immutable registry snapshots matching cached roots through edits and closes', () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new Map([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const store = createProjectArtifacts({
      inputs: resolveSchemaInputs({
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      }),
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
    });
    const first = store.document(schemaUri)!;
    const sibling = store.document(siblingUri)!;
    const snapshot = store.sources;
    expect(snapshot.sourceFileFor(first.document.syntax)).toBe(first.sourceFile);
    expect(snapshot.sourceFileFor(sibling.document.syntax)).toBe(sibling.sourceFile);
    expect(store.symbolTable()).toBe(store.symbolTable());

    texts.set(schemaUri, twoModelSource);
    store.documentChanged(schemaUri);
    expect(() => store.sources.sourceFileFor(first.document.syntax)).toThrow(/No SourceFile/);
    expect(store.sources.sourceFileFor(sibling.document.syntax)).toBe(sibling.sourceFile);
    const edited = store.document(schemaUri)!;
    expect(store.sources.sourceFileFor(edited.document.syntax)).toBe(edited.sourceFile);
    expect(snapshot.sourceFileFor(first.document.syntax)).toBe(first.sourceFile);
    expect(() => snapshot.sourceFileFor(edited.document.syntax)).toThrow(/No SourceFile/);

    texts.delete(schemaUri);
    store.documentClosed(schemaUri);
    expect(store.document(schemaUri)).toBeUndefined();
    expect(() => store.sources.sourceFileFor(edited.document.syntax)).toThrow(/No SourceFile/);
    expect(store.sources.sourceFileFor(sibling.document.syntax)).toBe(sibling.sourceFile);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(3);
  });

  it('a replacement project rejects roots from the previous configuration', () => {
    const previous = projectWithMirror();
    previous.texts.set(schemaUri, cleanSource);
    const old = previous.store.document(schemaUri)!;
    const replacement = projectWithMirror();
    replacement.texts.set(schemaUri, cleanSource);
    const current = replacement.store.document(schemaUri)!;
    expect(() => replacement.store.sources.sourceFileFor(old.document.syntax)).toThrow(
      /No SourceFile/,
    );
    expect(replacement.store.sources.sourceFileFor(current.document.syntax)).toBe(
      current.sourceFile,
    );
  });

  it('throws when no configured input is open instead of fabricating a table', () => {
    const { store } = projectWithMirror();

    expect(() => store.symbolTable()).toThrowError(
      /invariant violated.*no readable configured input/i,
    );
    expect(pipelineMock.runPipeline).not.toHaveBeenCalled();
  });

  it('drops the artifacts on documentClosed', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    store.document(schemaUri);

    texts.delete(schemaUri);
    store.documentClosed(schemaUri);

    expect(store.document(schemaUri)).toBeUndefined();
  });

  it('keeps document parse diagnostics separate from project symbol diagnostics', () => {
    const { texts, store } = projectWithMirror();
    const source = [`${directive}model Profile {`, '  user a.b.c', '}'].join('\n');
    texts.set(schemaUri, source);
    const { document, sources, diagnostics: parseDiagnostics } = parse(source, schemaUri);
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });

    expect(store.document(schemaUri)?.diagnostics).toEqual(mapParseDiagnostics(parseDiagnostics));
    expect(store.symbolDiagnostics()).toEqual(symbolTableDiagnostics);
  });

  it('does not throw on a malformed, half-typed buffer', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, `${directive}model User {\n  id `);
    expect(() => store.document(schemaUri)).not.toThrow();
  });
});

describe('interpret slot', () => {
  const spanned = {
    code: 'PSL_UNRESOLVED_RELATION',
    message: 'relation target not found',
    sourceId: schemaUri,
    span: { start: { offset: 31, line: 3, column: 3 }, end: { offset: 37, line: 3, column: 9 } },
  };

  it('reports an unexpected failure without caching it and recovers on the same artifacts', () => {
    const error = new Error('interpreter exploded');
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    spy.mockImplementationOnce(() => {
      throw error;
    });
    const { texts, store, onInterpretationError } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);
    const artifacts = store.document(schemaUri);

    expect(artifacts?.interpretDiagnostics()).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        code: 'PRISMA_NEXT_INTERPRETATION_FAILED',
        message:
          'Semantic diagnostics are unavailable because of an internal error. A subsequent diagnostic request or edit will retry.',
        severity: 1,
      },
    ]);
    expect(onInterpretationError).toHaveBeenCalledExactlyOnceWith(schemaUri, error);
    expect(artifacts?.interpretDiagnostics()).toEqual([]);
    expect(artifacts?.interpretDiagnostics()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('retries and reports every failed attempt without caching deterministic exceptions', () => {
    const error = new Error('deterministic failure');
    const { interpretation, spy } = interpretationDouble(() => {
      throw error;
    });
    const { texts, store, onInterpretationError } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);
    const artifacts = store.document(schemaUri);
    expect(artifacts?.interpretDiagnostics()).toEqual(artifacts?.interpretDiagnostics());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onInterpretationError.mock.calls).toEqual([
      [schemaUri, error],
      [schemaUri, error],
    ]);
  });

  it.each([
    LSPErrorCodes.RequestCancelled,
    LSPErrorCodes.ServerCancelled,
    LSPErrorCodes.ContentModified,
  ])('preserves protocol control-flow error %s', (code) => {
    const error = new ResponseError(code, 'cancelled', { retriggerRequest: false });
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    spy.mockImplementationOnce(() => {
      throw error;
    });
    const { texts, store, onInterpretationError } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);
    expect(() => store.document(schemaUri)?.interpretDiagnostics()).toThrow(error);
    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([]);
    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onInterpretationError).not.toHaveBeenCalled();
  });

  it('retries diagnostic mapping failures on the same artifacts', () => {
    const error = new Error('mapping failed');
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    spy.mockImplementationOnce(() =>
      notOk({
        summary: 'invalid finding',
        diagnostics: [
          {
            code: 'TEST',
            sourceId: schemaUri,
            get message(): string {
              throw error;
            },
          },
        ],
      }),
    );
    const { texts, store, onInterpretationError } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);
    const artifacts = store.document(schemaUri);
    expect(artifacts?.interpretDiagnostics().map((item) => item.code)).toEqual([
      'PRISMA_NEXT_INTERPRETATION_FAILED',
    ]);
    expect(onInterpretationError).toHaveBeenCalledExactlyOnceWith(schemaUri, error);
    expect(artifacts?.interpretDiagnostics()).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not interpret on document reads, only when the slot is pulled', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    store.symbolTable();
    expect(spy).not.toHaveBeenCalled();

    artifacts?.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('memoizes: repeated pulls interpret once, an edit interprets once more', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    store.document(schemaUri)?.interpretDiagnostics();
    store.document(schemaUri)?.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(1);

    texts.set(schemaUri, twoModelSource);
    store.documentChanged(schemaUri);
    store.document(schemaUri)?.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates retained semantic memos and shared symbols when registry membership changes', () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new Map([[schemaUri, cleanSource]]);
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const store = createProjectArtifacts({
      inputs: resolveSchemaInputs({
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      }),
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
      interpretation,
    });
    const first = store.document(schemaUri)!;
    first.interpretDiagnostics();
    const initialSymbols = store.symbolTable();
    texts.set(siblingUri, twoModelSource);
    first.interpretDiagnostics();
    const sibling = store.document(siblingUri)!;
    first.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0].sources).toBe(store.sources);
    expect(spy.mock.calls[1]?.[0].sources.sourceFileFor(sibling.document.syntax)).toBe(
      sibling.sourceFile,
    );
    expect(store.symbolTable()).not.toBe(initialSymbols);
    const siblingSymbols = store.symbolTable();
    texts.delete(siblingUri);
    store.documentClosed(siblingUri);
    first.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[0].sources).toBe(store.sources);
    expect(spy.mock.calls[2]?.[0].symbolTable).toBe(store.symbolTable());
    expect(store.symbolTable()).not.toBe(siblingSymbols);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(2);

    texts.set(siblingUri, twoModelSource);
    store.document(siblingUri);
    first.interpretDiagnostics();
    texts.set(siblingUri, cleanSource);
    store.documentChanged(siblingUri);
    first.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy.mock.calls[4]?.[0].sources).toBe(store.sources);
    expect(() => store.sources.sourceFileFor(sibling.document.syntax)).toThrow(/No SourceFile/);
    expect(store.document(schemaUri)).toBe(first);
  });

  it('unwraps a failing interpretation into mapped diagnostics', () => {
    const { interpretation } = interpretationDouble(() =>
      notOk({ summary: 'Schema has 1 error', diagnostics: [spanned] }),
    );
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([
      {
        range: { start: { line: 2, character: 2 }, end: { line: 2, character: 8 } },
        message: 'relation target not found',
        code: 'PSL_UNRESOLVED_RELATION',
        severity: 1,
      },
    ]);
  });

  it('filters semantic findings from sibling files before mapping their local spans', () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const { interpretation } = interpretationDouble(() =>
      notOk({
        summary: 'Two source errors',
        diagnostics: [
          { ...spanned, sourceId: schemaUri },
          { ...spanned, code: 'SIBLING_ERROR', sourceId: siblingUri },
        ],
      }),
    );
    const texts = new Map([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const store = createProjectArtifacts({
      inputs: resolveSchemaInputs({
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      }),
      controlStack,
      getDocument: (uri) => mirroredDocument(texts, uri),
      onInterpretationError: vi.fn(),
      interpretation,
    });
    expect(
      store
        .document(schemaUri)
        ?.interpretDiagnostics()
        .map(({ code }) => code),
    ).toEqual(['PSL_UNRESOLVED_RELATION']);
    expect(
      store
        .document(siblingUri)
        ?.interpretDiagnostics()
        .map(({ code }) => code),
    ).toEqual(['SIBLING_ERROR']);
  });

  it('returns no diagnostics for a successful interpretation', () => {
    const { interpretation } = interpretationDouble(() => ok({} as never));
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([]);
  });

  it('returns no diagnostics when the project carries no interpretation', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([]);
  });

  it('invokes interpret as a method with cached artifacts and registered sources', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    artifacts?.interpretDiagnostics();

    expect(spy.mock.contexts[0]).toBe(interpretation.source);
    const [input, context] = spy.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      document: artifacts?.document,
      sources: store.sources,
    });
    expect(input?.sources.sourceFileFor(input.document.syntax)).toBe(artifacts?.sourceFile);
    expect(input?.symbolTable).toBeDefined();
    expect(context).toBe(interpretation.context);
  });
});
