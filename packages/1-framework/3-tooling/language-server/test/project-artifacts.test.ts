import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  buildSymbolTable,
  createBinder,
  type DescribeUnsupportedAttribute,
  diagnosticSource,
  fieldAttribute,
} from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { notOk, ok } from '@internal/utils/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';
import type { ProjectInterpretation } from '../src/config-resolution';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { DocumentSnapshot } from '../src/document-snapshot';
import { DocumentStore } from '../src/document-store';
import type { LspControlStack } from '../src/lsp-control-stack';
import { ProjectArtifacts } from '../src/project-artifacts';
import { canonicalFileIdentity, resolveSchemaInputs } from '../src/schema-inputs';

vi.mock('@internal/psl-parser/syntax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/psl-parser/syntax')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

afterEach(() => {
  vi.mocked(parse).mockClear();
});

const schemaUri = 'file:///abs/schema.psl';
const siblingUri = 'file:///abs/sibling.psl';
const aliasUri = 'file:///abs/%73chema.psl';
const directive = '// use prisma-8\n';
const cleanSource = `${directive}model User {\n  id Int @id\n}\n`;
const siblingSource = `${directive}model Post {\n  id Int @id\n  user User\n}\n`;
const inputs = await resolveSchemaInputs(
  { contract: { source: { format: 'psl', inputs: ['/abs/schema.psl'] } } },
  () => directive,
);
const bothInputs = await resolveSchemaInputs(
  { contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } } },
  () => directive,
);

const interpretContext = {
  composedExtensions: [],
  authoringContributions: {
    type: {
      Int: { kind: 'typeConstructor', output: { codecId: 'test/Int@1', nativeType: 'Int' } },
    },
    field: {},
    entityTypes: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    attributeSpecs: { model: {}, field: {} },
    dataTypes: {},
  },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
} as unknown as ContractSourceContext;
const controlStack = {
  scalarTypes: ['Int'],
  pslBlockDescriptors: {},
  authoringContributions: assembleAuthoringContributions([
    {
      id: 'fixture',
      authoring: {
        type: {
          Int: { kind: 'typeConstructor', output: { codecId: 'int', nativeType: 'integer' } },
        },
        attributeSpecs: {
          model: {},
          field: { id: () => fieldAttribute('id', { documentation: '' }) },
        },
      },
    },
  ]),
  controlMutationDefaults: assembleControlMutationDefaults([]),
};

function describeUnsupportedTestAttribute(
  sources: Parameters<typeof diagnosticSource>[0],
): DescribeUnsupportedAttribute {
  return ({ attribute, level, owner, field }) => {
    if (level === 'model') {
      return {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: `Model "${owner.name}" uses unsupported attribute "@@${attribute.name}"`,
        ...diagnosticSource(sources, owner.node.syntax).at(attribute.span),
      };
    }
    if (field === undefined) return undefined;
    return {
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Field "${owner.name}.${field.name}" uses unsupported attribute "@${attribute.name}"`,
      ...diagnosticSource(sources, field.node.syntax).at(attribute.span),
    };
  };
}

const interpretContextWithUnsupportedAttribute = {
  ...interpretContext,
  pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedTestAttribute },
} as unknown as ContractSourceContext;

function interpretationDouble(
  interpret: PslInterpretCapable['interpret'],
  context: ContractSourceContext = interpretContext,
): {
  readonly interpretation: ProjectInterpretation;
  readonly spy: ReturnType<typeof vi.fn<PslInterpretCapable['interpret']>>;
} {
  const spy = vi.fn(interpret);
  const source = {
    format: 'psl',
    load: async () => ok({} as never),
    interpret: spy,
  } as unknown as PslInterpretCapable;
  return { interpretation: { source, context }, spy };
}

function projectWithSnapshots(
  interpretation?: ProjectInterpretation,
  multi = false,
  stack: LspControlStack = controlStack,
) {
  const snapshots = new Map<string, DocumentSnapshot>();
  const set = (uri: string, text: string) => {
    const snapshot = new DocumentSnapshot(uri, text);
    snapshots.set(canonicalFileIdentity(uri), snapshot);
    return snapshot;
  };
  const readSnapshot = vi.fn((uri: string) => snapshots.get(canonicalFileIdentity(uri)));
  const onInterpretationError = vi.fn();
  const project = new ProjectArtifacts({
    controlStack: stack,
    inputs: multi ? bothInputs : inputs,
    readSnapshot,
    onInterpretationError,
    ...(interpretation === undefined ? {} : { interpretation }),
  });
  return { project, snapshots, set, readSnapshot, onInterpretationError };
}

describe('ProjectArtifacts binder', () => {
  it('rebuilds the binder on edits and takes contributed types from the configuration', () => {
    const first = projectWithSnapshots();
    first.set(schemaUri, cleanSource);
    const initial = first.project.binder();
    first.set(schemaUri, siblingSource);
    first.project.documentChanged(schemaUri);
    expect(first.project.binder()).not.toBe(initial);
    const next = projectWithSnapshots(undefined, false, {
      ...controlStack,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'replacement',
          authoring: {
            type: {
              Int: { kind: 'typeConstructor', output: { codecId: 'other', nativeType: 'bigint' } },
            },
          },
        },
      ]),
    });
    const nextSnapshot = next.set(schemaUri, cleanSource);
    expect(
      next.project.binder().scopeAt(nextSnapshot.parse().document.syntax).lookup('Int'),
    ).toMatchObject({
      kind: 'contributedType',
      symbol: { descriptor: { output: { codecId: 'other', nativeType: 'bigint' } } },
    });
  });

  it('shares a binder for a snapshot and replaces it on edits, membership and close', () => {
    const { project, set } = projectWithSnapshots(undefined, true);
    set(schemaUri, cleanSource);
    set(siblingUri, siblingSource);
    const first = project.binder();
    const user = project.symbolTable().topLevel.models['User']!;
    expect(first.declaredSymbol(user.node.syntax)).toBe(user);
    expect(project.binder()).toBe(first);
    project.updateInputs(inputs);
    const second = project.binder();
    expect(second).not.toBe(first);
    expect(second.scopeAt(user.node.syntax).lookup('Post')).toBeUndefined();
    set(schemaUri, `${directive}model Changed { id Int }`);
    project.documentChanged(schemaUri);
    const third = project.binder();
    expect(third).not.toBe(second);
    expect(third.declaredSymbol(user.node.syntax)).toBeUndefined();
    const changed = project.symbolTable().topLevel.models['Changed']!;
    expect(third.scopeAt(changed.node.syntax).lookup('Changed')?.symbol).toBe(changed);
    expect(third.scopeAt(changed.node.syntax).lookup('User')).toBeUndefined();
    project.documentClosed(schemaUri);
    expect(project.binder()).not.toBe(third);
  });

  it('reports binder diagnostics with or without an interpreter', () => {
    const missing = `${directive}model User { id Missing }`;
    const fallback = projectWithSnapshots();
    fallback.set(schemaUri, missing);
    expect(fallback.project.diagnostics(schemaUri).map(({ code }) => code)).toEqual([
      'PSL_UNRESOLVED_REFERENCE',
    ]);
    const successful = projectWithSnapshots(
      interpretationDouble(() => ok({} as never)).interpretation,
    );
    successful.set(schemaUri, missing);
    expect(successful.project.diagnostics(schemaUri).map(({ code }) => code)).toEqual([
      'PSL_UNRESOLVED_REFERENCE',
    ]);
    const failed = projectWithSnapshots(
      interpretationDouble(() =>
        notOk({
          summary: 'preset',
          diagnostics: [{ sourceId: schemaUri, code: 'UNKNOWN_PRESET', message: 'preset' }],
        }),
      ).interpretation,
    );
    failed.set(schemaUri, missing);
    expect(failed.project.diagnostics(schemaUri).map(({ code }) => code)).toEqual([
      'PSL_UNRESOLVED_REFERENCE',
      'UNKNOWN_PRESET',
    ]);
  });

  it('resolves a field preset without an interpreter', () => {
    const { project, set } = projectWithSnapshots(undefined, false, {
      ...controlStack,
      authoringContributions: assembleAuthoringContributions([
        {
          id: 'fixture',
          authoring: {
            type: controlStack.authoringContributions.type,
            field: {
              temporal: {
                createdAt: {
                  kind: 'fieldPreset',
                  output: { codecId: 'timestamp', nativeType: 'timestamp' },
                },
              },
            },
          },
        },
      ]),
    });
    set(schemaUri, `${directive}model User {\n  id Int\n  createdAt temporal.createdAt()\n}\n`);
    expect(project.diagnostics(schemaUri)).toEqual([]);
  });

  it('describes unsupported attributes with the family describer without an interpreter', () => {
    const schema = `${directive}model User {\n  id Int\n  @@bogus\n}\n`;
    const { project, set } = projectWithSnapshots(undefined, false, {
      ...controlStack,
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedTestAttribute },
    });
    set(schemaUri, schema);
    expect(project.diagnostics(schemaUri).map(({ code }) => code)).toEqual([
      'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
    ]);
  });
});

describe('ProjectArtifacts snapshots', () => {
  it('returns the actual snapshot lazily and preserves normalized identity', () => {
    const { project, set } = projectWithSnapshots();
    const snapshot = set(aliasUri, cleanSource);
    expect(project.document(schemaUri)).toBe(snapshot);
    expect(project.document(aliasUri)).toBe(snapshot);
    expect(snapshot.text).toBe(cleanSource);
    expect(parse).not.toHaveBeenCalled();
    expect(snapshot.parse()).toBe(snapshot.parse());
    expect(snapshot.sourceFile.filename).toBe(schemaUri);
    project.symbolTable();
    project.diagnostics(aliasUri);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('keeps operations callable without a receiver', () => {
    const { project, set } = projectWithSnapshots();
    const {
      document,
      diagnostics,
      symbolTable,
      symbolDiagnostics,
      documentChanged,
      documentClosed,
      updateInputs,
    } = project;
    const first = set(schemaUri, cleanSource);
    expect(document(schemaUri)).toBe(first);
    const firstSymbols = symbolTable();
    expect(diagnostics(schemaUri)).toEqual([]);
    expect(symbolDiagnostics()).toEqual([]);
    const next = set(schemaUri, siblingSource);
    documentChanged(schemaUri);
    expect(document(schemaUri)).toBe(next);
    expect(symbolTable()).not.toBe(firstSymbols);
    const sources = project.sources;
    documentClosed(schemaUri);
    expect(project.sources).not.toBe(sources);
    updateInputs(inputs);
    expect(document(schemaUri)).toBe(next);
  });

  it.each(['missing', 'unmarked', 'nonmember'])(
    'gates %s documents without parsing or interpreting',
    (kind) => {
      const { interpretation, spy } = interpretationDouble(() => ok({} as never));
      const { project, set } = projectWithSnapshots(interpretation);
      const uri = kind === 'nonmember' ? siblingUri : schemaUri;
      if (kind !== 'missing') set(uri, kind === 'unmarked' ? 'model User { id Int }' : cleanSource);
      expect(project.document(uri)).toBeUndefined();
      expect(project.diagnostics(uri)).toEqual([]);
      expect(parse).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
      if (kind === 'unmarked') {
        const snapshot = set(uri, cleanSource);
        project.documentChanged(uri);
        expect(project.document(uri)).toBe(snapshot);
        expect(Object.keys(project.symbolTable().topLevel.models)).toEqual(['User']);
      }
    },
  );

  it('shares parsing but not interpretation or symbols across projects', () => {
    const documents = new DocumentStore();
    documents.open({ uri: aliasUri, languageId: 'prisma', version: 1, text: cleanSource });
    const firstInterpretation = interpretationDouble(() => ok({} as never));
    const nextInterpretation = interpretationDouble(() =>
      notOk({
        summary: 'changed',
        diagnostics: [{ sourceId: schemaUri, code: 'CHANGED', message: 'changed' }],
      }),
    );
    const create = (interpretation: ProjectInterpretation) =>
      new ProjectArtifacts({
        controlStack,
        inputs,
        readSnapshot: documents.readSnapshot,
        onInterpretationError: vi.fn(),
        interpretation,
      });
    const first = create(firstInterpretation.interpretation);
    const second = create(nextInterpretation.interpretation);
    expect(first.document(schemaUri)).toBe(second.document(aliasUri));
    expect(parse).not.toHaveBeenCalled();
    expect(first.diagnostics(schemaUri)).toEqual([]);
    expect(second.diagnostics(aliasUri).map(({ code }) => code)).toEqual(['CHANGED']);
    expect(first.diagnostics(aliasUri)).toEqual([]);
    expect(firstInterpretation.spy).toHaveBeenCalledTimes(1);
    expect(nextInterpretation.spy).toHaveBeenCalledTimes(1);
    expect(second.symbolTable()).not.toBe(first.symbolTable());
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('parses with the parser options the project declares, once per stored snapshot', () => {
    const documents = new DocumentStore();
    const view = `${directive}view ActiveUsers {\n  id Int @unique\n}\n`;
    documents.open({ uri: schemaUri, languageId: 'prisma', version: 1, text: view });
    const parserOptions = { grammar: 'prisma-7' } as const;
    const withOptions = new ProjectArtifacts({
      controlStack,
      inputs,
      readSnapshot: documents.readSnapshot,
      onInterpretationError: vi.fn(),
      parserOptions,
    });
    const withoutOptions = new ProjectArtifacts({
      controlStack,
      inputs,
      readSnapshot: documents.readSnapshot,
      onInterpretationError: vi.fn(),
    });

    expect(withOptions.document(schemaUri)).toBe(withOptions.document(schemaUri));
    expect(withOptions.diagnostics(schemaUri)).toEqual([]);
    expect(withoutOptions.diagnostics(schemaUri).map(({ code }) => code)).toEqual([
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
    ]);
    expect(vi.mocked(parse).mock.calls).toEqual([
      [view, schemaUri, parserOptions],
      [view, schemaUri, {}],
    ]);
  });

  it('keeps immutable source registries across edits, membership changes and closes', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { project, set, snapshots } = projectWithSnapshots(interpretation, true);
    const first = set(schemaUri, cleanSource);
    const sibling = set(siblingUri, siblingSource);
    project.diagnostics(schemaUri);
    const sources = project.sources;
    const symbols = project.symbolTable();
    expect(sources.sourceFileFor(first.parse().document.syntax)).toBe(first.sourceFile);
    project.updateInputs(inputs);
    expect(project.document(siblingUri)).toBeUndefined();
    expect(project.diagnostics(siblingUri)).toEqual([]);
    expect(project.document(schemaUri)).toBe(first);
    expect(() => project.sources.sourceFileFor(sibling.parse().document.syntax)).toThrow(
      /No SourceFile/,
    );
    expect(project.symbolTable()).not.toBe(symbols);
    project.diagnostics(schemaUri);
    project.updateInputs(bothInputs);
    project.diagnostics(schemaUri);
    expect(project.document(siblingUri)).toBe(sibling);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(parse).toHaveBeenCalledTimes(2);
    const edited = set(siblingUri, `${directive}model Other { id Int }`);
    project.diagnostics(schemaUri);
    expect(Object.keys(project.symbolTable().topLevel.models)).toEqual(['User', 'Other']);
    expect(project.document(siblingUri)).toBe(edited);
    expect(() => project.sources.sourceFileFor(sibling.parse().document.syntax)).toThrow(
      /No SourceFile/,
    );
    expect(sources.sourceFileFor(sibling.parse().document.syntax)).toBe(sibling.sourceFile);
    snapshots.delete(canonicalFileIdentity(schemaUri));
    project.documentClosed(aliasUri);
    project.diagnostics(siblingUri);
    expect(project.document(schemaUri)).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(5);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('parses once per snapshot despite mutable editor updates and reset versions', () => {
    const documents = new DocumentStore();
    const opened = documents.open({
      uri: aliasUri,
      languageId: 'prisma',
      version: 1,
      text: cleanSource,
    });
    const project = new ProjectArtifacts({
      controlStack,
      inputs,
      readSnapshot: documents.readSnapshot,
      onInterpretationError: vi.fn(),
    });
    const first = project.document(schemaUri)!;
    project.symbolTable();
    expect(documents.change({ uri: schemaUri, version: 2 }, [{ text: siblingSource }])).toBe(
      opened,
    );
    const second = project.document(aliasUri)!;
    expect(second).not.toBe(first);
    project.symbolTable();
    documents.close(aliasUri);
    documents.open({ uri: schemaUri, languageId: 'prisma', version: 1, text: cleanSource });
    const third = project.document(schemaUri)!;
    expect(third).not.toBe(first);
    expect(third.sourceFile.filename).toBe(schemaUri);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])('refreshes disk snapshots with watcher coverage %s', async (watched) => {
    const dir = await mkdtemp(join(tmpdir(), 'project-artifacts-'));
    try {
      const path = join(dir, 'schema.psl');
      const uri = pathToFileURL(path).href;
      await writeFile(path, cleanSource);
      const documents = new DocumentStore();
      if (watched) documents.setWatchCoverage('project', [uri]);
      const project = new ProjectArtifacts({
        controlStack,
        inputs: await resolveSchemaInputs(
          { contract: { source: { format: 'psl', inputs: [path] } } },
          (uri) => documents.text(uri),
        ),
        readSnapshot: documents.readSnapshot,
        onInterpretationError: vi.fn(),
      });
      const first = project.document(uri);
      expect(first).toBe(documents.readSnapshot(uri));
      expect(parse).not.toHaveBeenCalled();
      project.symbolTable();
      await writeFile(path, siblingSource);
      if (watched) {
        expect(project.document(uri)).toBe(first);
        documents.invalidate(uri);
      }
      expect(project.document(uri)).not.toBe(first);
      expect(Object.keys(project.symbolTable().topLevel.models)).toEqual(['Post']);
      expect(parse).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ProjectArtifacts diagnostics', () => {
  it('combines parse, symbol and interpretation diagnostics without adding LSP data to snapshots', () => {
    const { interpretation } = interpretationDouble(() =>
      notOk({
        summary: 'semantic',
        diagnostics: [{ sourceId: schemaUri, code: 'SEMANTIC', message: 'semantic' }],
      }),
    );
    const { project, set } = projectWithSnapshots(interpretation);
    const snapshot = set(schemaUri, `${cleanSource}\nmodel User {\n  id Int @id\n}\nmodel {`);
    const diagnostics = project.diagnostics(aliasUri);
    const parseDiagnostics = mapParseDiagnostics(snapshot.parse().diagnostics);
    expect(parseDiagnostics.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([
      ...parseDiagnostics,
      ...mapParseDiagnostics(project.symbolDiagnostics()),
      {
        code: 'SEMANTIC',
        message: 'semantic',
        severity: 1,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ]);
    expect(diagnostics.map(({ code }) => code)).toContain('PSL_DUPLICATE_DECLARATION');
    expect(snapshot).not.toHaveProperty('diagnostics');
    expect(snapshot).not.toHaveProperty('interpretDiagnostics');
  });

  it('assembles a whole project with one symbol sweep and one interpretation per revision', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { project, set, readSnapshot } = projectWithSnapshots(interpretation, true);
    set(schemaUri, cleanSource);
    set(siblingUri, cleanSource);
    const diagnostics = project.symbolDiagnostics();
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(project.diagnostics(schemaUri, diagnostics)).toEqual([]);
    expect(project.diagnostics(siblingUri, diagnostics)).toEqual(mapParseDiagnostics(diagnostics));
    expect(readSnapshot).toHaveBeenCalledTimes(4);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(spy.mock.contexts[0]).toBe(interpretation.source);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      sources: project.sources,
      symbolTable: project.symbolTable(),
    });
    set(siblingUri, siblingSource);
    project.diagnostics(schemaUri);
    expect(project.diagnostics(siblingUri)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('discovers newly readable siblings on the next diagnostic request', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { project, set, snapshots } = projectWithSnapshots(interpretation, true);
    set(schemaUri, cleanSource);
    project.diagnostics(schemaUri);
    const initialSymbols = project.symbolTable();
    set(siblingUri, siblingSource);
    project.diagnostics(schemaUri);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0].documents).toHaveLength(2);
    expect(project.symbolTable()).not.toBe(initialSymbols);
    snapshots.delete(canonicalFileIdentity(siblingUri));
    project.diagnostics(schemaUri);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[0].documents).toHaveLength(1);
  });

  it('maps warnings before failures per source and ignores unknown sources', () => {
    const { interpretation, spy } = interpretationDouble((_input, context) => {
      context.reportWarning?.({ code: 'W1', message: 'first', sourceId: schemaUri });
      context.reportWarning?.({
        code: 'W2',
        message: 'second',
        sourceId: siblingUri,
        span: {
          start: { offset: 31, line: 3, column: 3 },
          end: { offset: 37, line: 3, column: 9 },
        },
      });
      return notOk({
        summary: 'errors',
        diagnostics: [
          { code: 'E1', message: 'third', sourceId: schemaUri },
          { code: 'E2', message: 'fourth', sourceId: siblingUri },
          {
            code: 'UNKNOWN',
            sourceId: 'file:///abs/missing.psl',
            get message(): string {
              throw new Error('must not map');
            },
          },
        ],
      });
    });
    const { project, set } = projectWithSnapshots(interpretation, true);
    set(schemaUri, cleanSource);
    set(siblingUri, siblingSource);
    const start = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const span = { start: { line: 2, character: 2 }, end: { line: 2, character: 8 } };
    expect(project.diagnostics(aliasUri)).toEqual([
      { code: 'W1', message: 'first', severity: 2, range: start },
      { code: 'E1', message: 'third', severity: 1, range: start },
    ]);
    expect(project.diagnostics(siblingUri)).toEqual([
      { code: 'W2', message: 'second', severity: 2, range: span },
      { code: 'E2', message: 'fourth', severity: 1, range: start },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not interpret on document or symbol reads', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { project, set } = projectWithSnapshots(interpretation);
    set(schemaUri, cleanSource);
    project.document(schemaUri);
    project.symbolTable();
    expect(spy).not.toHaveBeenCalled();
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['interpretation', 'mapping'])('retries %s errors without caching them', (stage) => {
    const error = new Error('failure');
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    spy.mockImplementationOnce(() => {
      if (stage === 'interpretation') throw error;
      return notOk({
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
      });
    });
    const { project, set, onInterpretationError } = projectWithSnapshots(interpretation);
    const snapshot = set(schemaUri, cleanSource);
    expect(project.diagnostics(aliasUri)).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        code: 'PRISMA_NEXT_INTERPRETATION_FAILED',
        message:
          'Semantic diagnostics are unavailable because of an internal error. A subsequent diagnostic request or edit will retry.',
        severity: 1,
      },
    ]);
    expect(onInterpretationError).toHaveBeenCalledExactlyOnceWith(schemaUri, error);
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(project.document(schemaUri)).toBe(snapshot);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports each deterministic failure without caching exceptions', () => {
    const error = new Error('failure');
    const { interpretation, spy } = interpretationDouble(() => {
      throw error;
    });
    const { project, set, onInterpretationError } = projectWithSnapshots(interpretation);
    set(schemaUri, cleanSource);
    expect(project.diagnostics(schemaUri)).toEqual(project.diagnostics(schemaUri));
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
  ])('preserves protocol error %s and retries', (code) => {
    const error = new ResponseError(code, 'cancelled', { retriggerRequest: false });
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    spy.mockImplementationOnce(() => {
      throw error;
    });
    const { project, set, onInterpretationError } = projectWithSnapshots(interpretation);
    set(schemaUri, cleanSource);
    expect(() => project.diagnostics(schemaUri)).toThrow(error);
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(onInterpretationError).not.toHaveBeenCalled();
  });

  it('serves empty projects without parsing', () => {
    const { project } = projectWithSnapshots();
    expect(project.diagnostics(schemaUri)).toEqual([]);
    expect(project.symbolDiagnostics()).toEqual([]);
    expect(Object.keys(project.symbolTable().topLevel.models)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('ProjectArtifacts binder', () => {
  it('reports the same single unsupported-attribute diagnostic as createBinder produces directly', () => {
    const schema = `${directive}model User {\n  id Int\n  @@bogus\n}\n`;
    const { interpretation } = interpretationDouble(
      () => ok({} as never),
      interpretContextWithUnsupportedAttribute,
    );
    const { project, set } = projectWithSnapshots(interpretation);
    set(schemaUri, schema);

    const { document, sources } = parse(schema, schemaUri);
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });
    const { diagnostics: expected } = createBinder({
      symbolTable,
      sources,
      context: interpretContextWithUnsupportedAttribute,
    });

    expect(expected).toHaveLength(1);
    expect(project.diagnostics(schemaUri)).toEqual(mapParseDiagnostics(expected));
  });

  it('reports the same single unknown-type diagnostic as createBinder produces directly', () => {
    const schema = `${directive}model User {\n  id Int @id\n  role Role\n}\n`;
    const { interpretation } = interpretationDouble(() => ok({} as never));
    const { project, set } = projectWithSnapshots(interpretation);
    set(schemaUri, schema);

    const { document, sources } = parse(schema, schemaUri);
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });
    const { diagnostics: expected } = createBinder({
      symbolTable,
      sources,
      context: interpretContext,
    });

    expect(expected).toHaveLength(1);
    expect(project.diagnostics(schemaUri)).toEqual(mapParseDiagnostics(expected));
  });

  it('serves the same binder instance across repeated reads and to interpret', () => {
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const { project, set } = projectWithSnapshots(interpretation);
    set(schemaUri, cleanSource);
    const first = project.binder();
    expect(first).toBeDefined();
    expect(project.binder()).toBe(first);
    project.diagnostics(schemaUri);
    expect(spy.mock.calls[0]?.[0].binder).toBe(first);
  });

  it('produces a new binder after a document edit', () => {
    const { interpretation } = interpretationDouble(() => ok({} as never));
    const { project, set } = projectWithSnapshots(interpretation);
    set(schemaUri, cleanSource);
    const first = project.binder();
    set(schemaUri, `${directive}model User {\n  id Int @id\n  name Int\n}\n`);
    project.documentChanged(schemaUri);
    const second = project.binder();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('builds a binder from the control stack without an interpretation', () => {
    const { project, set } = projectWithSnapshots();
    set(schemaUri, cleanSource);
    expect(project.binder()).toBeDefined();
  });
});
