import { pathToFileURL } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import { buildSymbolTable } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { notOk, ok } from '@internal/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInterpretation } from '../src/config-resolution';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import type { PipelineInputs } from '../src/pipeline';
import { createProjectArtifacts, type ProjectArtifacts } from '../src/project-artifacts';
import { resolveSchemaInputs } from '../src/schema-inputs';

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

const directive = '// use prisma-next\n';
const cleanSource = `${directive}model User {\n  id Int @id\n}\n`;
const twoModelSource = `${directive}model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n`;
const unmarkedSource = 'model Stray {\n  id Int @id\n}\n';

function projectWithMirror(interpretation?: ProjectInterpretation): {
  readonly texts: Map<string, string>;
  readonly store: ProjectArtifacts;
} {
  const texts = new Map<string, string>();
  const store = createProjectArtifacts({
    inputs,
    controlStack,
    getText: (uri) => texts.get(uri),
    ...(interpretation === undefined ? {} : { interpretation }),
  });
  return { texts, store };
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
  it('parses the mirrored text on first read', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    expect(artifacts?.document).toBeDefined();
    expect(artifacts?.sourceFile).toBeDefined();
    expect(artifacts?.diagnostics).toEqual([]);
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

  it('returns undefined for a configured input without the prisma-next directive', () => {
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
      getText: (uri) => texts.get(uri),
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
      getText: (uri) => texts.get(uri),
    });
    texts.set(schemaUri, cleanSource);
    texts.set(schema2Uri, twoModelSource);
    store.document(schemaUri);
    store.document(schema2Uri);

    texts.delete(schema2Uri);
    store.documentClosed(schema2Uri);

    expect(Object.keys(store.symbolTable().topLevel.models)).toContain('User');
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

  it('returns diagnostics with parity to parse + buildSymbolTable for the same inputs', () => {
    const { texts, store } = projectWithMirror();
    const source = [`${directive}model Profile {`, '  user a.b.c', '}'].join('\n');
    texts.set(schemaUri, source);
    const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });

    expect(store.document(schemaUri)?.diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
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
    span: { start: { offset: 34, line: 3, column: 3 }, end: { offset: 40, line: 3, column: 9 } },
  };

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

  it('invokes interpret as a method with the document uri as sourceId and cached artifacts', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { texts, store } = projectWithMirror(interpretation);
    texts.set(schemaUri, cleanSource);

    const artifacts = store.document(schemaUri);
    artifacts?.interpretDiagnostics();

    expect(spy.mock.contexts[0]).toBe(interpretation.source);
    const [input, context] = spy.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      sourceId: schemaUri,
      document: artifacts?.document,
      sourceFile: artifacts?.sourceFile,
    });
    expect(input?.symbolTable).toBeDefined();
    expect(context).toBe(interpretation.context);
  });
});
