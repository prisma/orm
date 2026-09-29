import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { createDocumentSnapshot, type DocumentSnapshot } from '../src/document-snapshot';
import { DocumentStore } from '../src/document-store';
import { createProjectArtifacts, type ProjectArtifacts } from '../src/project-artifacts';
import { canonicalFileIdentity, resolveSchemaInputs } from '../src/schema-inputs';

vi.mock('@internal/psl-parser/syntax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/psl-parser/syntax')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

afterEach(() => {
  vi.mocked(parse).mockClear();
});

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const alwaysMember = (): string => '// use prisma-8\n';
const inputs = await resolveSchemaInputs(
  { contract: { source: { format: 'psl', inputs: ['/abs/schema.psl'] } } },
  alwaysMember,
);

const directive = '// use prisma-8\n';
const cleanSource = `${directive}model User {\n  id Int @id\n}\n`;
const twoModelSource = `${directive}model User {\n  id Int @id\n}\n\nmodel Post {\n  id Int @id\n}\n`;
const unmarkedSource = 'model Stray {\n  id Int @id\n}\n';

class TextMirror extends Map<string, string> {
  private readonly snapshots = new Map<string, DocumentSnapshot>();

  constructor(entries: readonly (readonly [string, string])[] = []) {
    super();
    for (const [uri, text] of entries) this.set(uri, text);
  }

  override set(uri: string, text: string): this {
    this.snapshots.set(uri, createDocumentSnapshot(uri, text));
    return super.set(uri, text);
  }

  override delete(uri: string): boolean {
    this.snapshots.delete(uri);
    return super.delete(uri);
  }

  readonly readSnapshot = (uri: string): DocumentSnapshot | undefined => {
    for (const [sourceUri, snapshot] of this.snapshots) {
      if (canonicalFileIdentity(sourceUri) === canonicalFileIdentity(uri)) return snapshot;
    }
    return undefined;
  };
}

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

function mirroredText(texts: ReadonlyMap<string, string>, uri: string): string | undefined {
  for (const [diskUri, text] of texts) {
    if (canonicalFileIdentity(diskUri) === canonicalFileIdentity(uri)) {
      return text;
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
  const texts = new TextMirror();
  const store = createProjectArtifacts({ inputs, onInterpretationError,
  readSnapshot: texts.readSnapshot,
  ...(interpretation === undefined ? {} : { interpretation }), });
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
  it('shares snapshot parsing across project and interpretation replacements', () => {
    const documents = new DocumentStore();
    documents.open({ uri: schemaUri, languageId: 'prisma', version: 1, text: cleanSource });
    const firstInterpretation = interpretationDouble(() => ok({} as never));
    const nextInterpretation = interpretationDouble(() =>
      notOk({
        summary: 'changed config',
        diagnostics: [{ sourceId: schemaUri, code: 'CHANGED', message: 'changed' }],
      }),
    );
    const create = (interpretation: ProjectInterpretation) =>
      createProjectArtifacts({ inputs, readSnapshot: documents.readSnapshot,
      onInterpretationError: vi.fn(),
      interpretation, });
    const first = create(firstInterpretation.interpretation);
    const second = create(nextInterpretation.interpretation);
    expect(parse).not.toHaveBeenCalled();
    const previous = first.document(schemaUri)!;
    expect(previous.interpretDiagnostics()).toEqual([]);
    const current = second.document(schemaUri)!;
    expect(current.document).toBe(previous.document);
    expect(current.sourceFile).toBe(previous.sourceFile);
    expect(current.interpretDiagnostics().map(({ code }) => code)).toEqual(['CHANGED']);
    expect(firstInterpretation.spy).toHaveBeenCalledTimes(1);
    expect(nextInterpretation.spy).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(second.symbolTable()).not.toBe(first.symbolTable());
  });

  it('invalidates project artifacts on membership changes without reparsing retained snapshots', async () => {
    const siblingUri = 'file:///abs/sibling.psl';
    const texts = new TextMirror([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const bothInputs = await resolveSchemaInputs(
      { contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } } },
      alwaysMember,
    );
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const project = createProjectArtifacts({ inputs: bothInputs, readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(),
    interpretation, });
    const first = project.document(schemaUri)!;
    const sibling = project.document(siblingUri)!;
    const originalSources = project.sources;
    const originalSymbols = project.symbolTable();
    first.interpretDiagnostics();
    expect(project.symbolDiagnostics()).toHaveLength(1);
    project.updateInputs(inputs);
    expect(project.document(siblingUri)).toBeUndefined();
    expect(project.document(schemaUri)).toBe(first);
    expect(project.sources).not.toBe(originalSources);
    expect(() => project.sources.sourceFileFor(sibling.document.syntax)).toThrow(/No SourceFile/);
    expect(project.symbolTable()).not.toBe(originalSymbols);
    expect(project.symbolDiagnostics()).toEqual([]);
    first.interpretDiagnostics();
    project.updateInputs(bothInputs);
    expect(project.document(siblingUri)?.document).toBe(sibling.document);
    expect(project.symbolDiagnostics()).toHaveLength(1);
    first.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(originalSources.sourceFileFor(sibling.document.syntax)).toBe(sibling.sourceFile);
  });

  it('maps malformed parser diagnostics without adding symbol diagnostics to the document', () => {
    const { texts, store } = projectWithMirror();
    const source = `${directive}model {`;
    texts.set(schemaUri, source);
    const result = store.document(schemaUri)!;
    expect(result.diagnostics).toEqual(mapParseDiagnostics(parse(source, schemaUri).diagnostics));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('symbolTable');
    texts.set(schemaUri, `${cleanSource}\nmodel User {\n id Int @id\n}`);
    expect(store.document(schemaUri)?.diagnostics.map(({ code }) => code)).not.toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
  });
  it.each([false, true])('refreshes disk artifacts with watcher coverage %s', async (watched) => {
    const dir = await mkdtemp(join(tmpdir(), 'project-artifacts-'));
    try {
      const path = join(dir, 'schema.psl');
      const uri = pathToFileURL(path).href;
      await writeFile(path, cleanSource);
      const documents = new DocumentStore();
      if (watched) documents.setWatchCoverage('project', [uri]);
      const project = createProjectArtifacts({ inputs: await resolveSchemaInputs(
        { contract: { source: { format: 'psl', inputs: [path] } } },
        (uri) => documents.text(uri),
      ), readSnapshot: documents.readSnapshot,
      onInterpretationError: vi.fn(), });
      const first = project.document(uri);
      expect(first).toBeDefined();
      expect(project.document(uri)).toBe(first);
      expect(vi.mocked(parse)).toHaveBeenCalledTimes(1);
      await writeFile(path, twoModelSource);
      if (watched) {
        expect(project.document(uri)).toBe(first);
        documents.invalidate(uri);
      }
      const second = project.document(uri);
      expect(second).not.toBe(first);
      expect(Object.keys(project.symbolTable().topLevel.models)).toEqual(['User', 'Post']);
      expect(project.document(uri)).toBe(second);
      expect(vi.mocked(parse)).toHaveBeenCalledTimes(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parses once per store snapshot despite mutable updates and reset editor versions', () => {
    const documents = new DocumentStore();
    const liveUri = 'file:///abs/%73chema.psl';
    const opened = documents.open({
      uri: liveUri,
      languageId: 'prisma',
      version: 1,
      text: cleanSource,
    });
    const project = createProjectArtifacts({ inputs, readSnapshot: documents.readSnapshot,
    onInterpretationError: vi.fn(), });
    const first = project.document(schemaUri)!;
    project.symbolTable();
    expect(project.document(liveUri)).toBe(first);
    expect(first.sourceFile.filename).toBe(schemaUri);
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(1);
    expect(
      documents.change({ uri: schemaUri, version: 2 }, [
        {
          range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
          text: 'Post',
        },
      ]),
    ).toBe(opened);
    const second = project.document(schemaUri)!;
    expect(second).not.toBe(first);
    expect(project.document(liveUri)).toBe(second);
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(2);
    documents.close(liveUri);
    documents.open({ uri: schemaUri, languageId: 'prisma', version: 1, text: cleanSource });
    const third = project.document(liveUri)!;
    expect(third).not.toBe(first);
    expect(third.sourceFile.filename).toBe(schemaUri);
    expect(project.document(schemaUri)).toBe(third);
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(3);
  });
  it('owns symbol diagnostics at project level in configured order with source filenames', async () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new TextMirror([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const store = createProjectArtifacts({ inputs: await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      alwaysMember,
    ), readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(),
    interpretation, });
    const sibling = store.document(siblingUri)!;
    expect(sibling.diagnostics).toEqual([]);
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(1);
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
  it('shows a warning the interpreter reports at its span, with warning severity', () => {
    const texts = new TextMirror([[schemaUri, cleanSource]]);
    const { interpretation } = interpretationDouble((_input, context) => {
      context.reportWarning?.({
        code: 'PSL_DEPRECATED_SCALAR_NAME',
        message:
          'Scalar type "Int" is deprecated and will be removed; use "Int32" (stored as BSON int).',
        sourceId: schemaUri,
        span: {
          start: { offset: 34, line: 3, column: 6 },
          end: { offset: 37, line: 3, column: 9 },
        },
        severity: 'warning',
      });
      return ok({} as never);
    });
    const artifacts = createProjectArtifacts({ inputs, readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(),
    interpretation, });

    expect(artifacts.document(schemaUri)?.interpretDiagnostics()).toEqual([
      {
        range: { start: { line: 2, character: 5 }, end: { line: 2, character: 8 } },
        code: 'PSL_DEPRECATED_SCALAR_NAME',
        message:
          'Scalar type "Int" is deprecated and will be removed; use "Int32" (stored as BSON int).',
        severity: 2,
      },
    ]);
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
    expect(first.sourceFile.filename).toBe(schemaUri);
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

  it('returns the same artifacts for repeated reads while the underlying text is unchanged', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    expect(store.document(schemaUri)).toBe(first);
  });

  it('picks up a disk-origin member text change on the next read without a documentChanged event', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);

    texts.set(schemaUri, twoModelSource);

    const second = store.document(schemaUri);
    expect(second).not.toBe(first);
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User', 'Post']);
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
    expect(vi.mocked(parse)).not.toHaveBeenCalled();
  });

  it('returns undefined for documents that are not configured inputs', () => {
    const { texts, store } = projectWithMirror();
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    texts.set(otherUri, cleanSource);

    expect(store.document(otherUri)).toBeUndefined();
    expect(vi.mocked(parse)).not.toHaveBeenCalled();
  });

  it('returns undefined for a configured input without the prisma-8 directive', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, unmarkedSource);

    expect(store.document(schemaUri)).toBeUndefined();
    expect(vi.mocked(parse)).not.toHaveBeenCalled();
  });

  it('serves a configured input again once an edit adds the directive', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, unmarkedSource);
    expect(store.document(schemaUri)).toBeUndefined();

    texts.set(schemaUri, `${directive}${unmarkedSource}`);
    store.documentChanged(schemaUri);

    expect(store.document(schemaUri)?.document).toBeDefined();
  });

  it('excludes an unmarked sibling input from the symbol table', async () => {
    const schema2Uri = pathToFileURL('/abs/schema2.psl').toString();
    const texts = new TextMirror();
    const readText = (uri: string): string | undefined => mirroredDocument(texts, uri)?.getText();
    const twoInputs = await resolveSchemaInputs(
      {
        contract: {
          source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/schema2.psl'] },
        },
      },
      readText,
    );
    const store = createProjectArtifacts({ inputs: twoInputs, readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(), });
    texts.set(schemaUri, unmarkedSource);
    texts.set(schema2Uri, cleanSource);

    expect(store.document(schemaUri)).toBeUndefined();
    const models = Object.keys(store.symbolTable().topLevel.models);
    expect(models).toContain('User');
    expect(models).not.toContain('Stray');
  });

  it('reads an unopened member from disk and resolves a cross-file reference against it', async () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const overlayTexts = new TextMirror([
      [
        schemaUri,
        `${directive}model Order {\n  id Int @id\n  customer Customer @relation(fields: [customerId])\n  customerId Int\n}\n`,
      ],
    ]);
    const diskTexts = new TextMirror([
      [siblingUri, `${directive}model Customer {\n  id Int @id\n}\n`],
    ]);
    const readText = (uri: string): string | undefined =>
      mirroredDocument(overlayTexts, uri)?.getText() ?? mirroredText(diskTexts, uri);
    const inputsWithDiskSibling = await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      readText,
    );
    const store = createProjectArtifacts({ inputs: inputsWithDiskSibling, readSnapshot: (uri) => overlayTexts.readSnapshot(uri) ?? diskTexts.readSnapshot(uri),
    onInterpretationError: vi.fn(), });

    const artifacts = store.document(schemaUri);
    expect(artifacts?.diagnostics).toEqual([]);
    expect(store.document(siblingUri)?.document).toBeDefined();
    const models = Object.keys(store.symbolTable().topLevel.models);
    expect(models).toEqual(expect.arrayContaining(['Order', 'Customer']));
  });

  it('reading the symbol table on a fresh store parses the open configured input once', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    expect(Object.keys(store.symbolTable().topLevel.models)).toContain('User');
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(1);
  });

  it('a document read after a symbol-table read reuses the same parse', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);

    store.symbolTable();
    expect(store.document(schemaUri)?.document).toBeDefined();
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the symbol table from a sibling input after the contributing document closes', async () => {
    const schema2Uri = pathToFileURL('/abs/schema2.psl').toString();
    const texts = new TextMirror();
    const readText = (uri: string): string | undefined => mirroredDocument(texts, uri)?.getText();
    const twoInputs = await resolveSchemaInputs(
      {
        contract: {
          source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/schema2.psl'] },
        },
      },
      readText,
    );
    const store = createProjectArtifacts({ inputs: twoInputs, readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(), });
    texts.set(schemaUri, cleanSource);
    texts.set(schema2Uri, twoModelSource);
    store.document(schemaUri);
    store.document(schema2Uri);

    texts.delete(schema2Uri);
    store.documentClosed(schema2Uri);

    expect(Object.keys(store.symbolTable().topLevel.models)).toContain('User');
  });

  it('owns immutable registry snapshots matching cached roots through edits and closes', async () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new TextMirror([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const readText = (uri: string): string | undefined => mirroredDocument(texts, uri)?.getText();
    const store = createProjectArtifacts({ inputs: await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      readText,
    ), readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(), });
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
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(3);
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

  it('returns an empty table instead of throwing when no configured input is readable', () => {
    const { store } = projectWithMirror();

    expect(() => store.symbolTable()).not.toThrow();
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual([]);
    expect(store.symbolDiagnostics()).toEqual([]);
    expect(vi.mocked(parse)).not.toHaveBeenCalled();
  });

  it('keeps computing after its last open document closes (design decision 8)', () => {
    const { texts, store } = projectWithMirror();
    texts.set(schemaUri, cleanSource);
    const first = store.document(schemaUri);
    expect(first?.document).toBeDefined();
    expect(Object.keys(store.symbolTable().topLevel.models)).toEqual(['User']);

    texts.delete(schemaUri);
    store.documentClosed(schemaUri);

    expect(() => store.symbolTable()).not.toThrow();
    expect(store.document(schemaUri)).toBeUndefined();
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

  it('invalidates retained semantic memos and shared symbols when registry membership changes', async () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const texts = new TextMirror([[schemaUri, cleanSource]]);
    const readText = (uri: string): string | undefined => mirroredDocument(texts, uri)?.getText();
    const { interpretation, spy } = interpretationDouble(() => ok({} as never));
    const store = createProjectArtifacts({ inputs: await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      readText,
    ), readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(),
    interpretation, });
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
    expect(vi.mocked(parse)).toHaveBeenCalledTimes(2);

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

  it('filters semantic findings from sibling files before mapping their local spans', async () => {
    const siblingUri = pathToFileURL('/abs/sibling.psl').toString();
    const { interpretation, spy } = interpretationDouble(() =>
      notOk({
        summary: 'Two source errors',
        diagnostics: [
          { ...spanned, sourceId: schemaUri },
          { ...spanned, code: 'SIBLING_ERROR', sourceId: siblingUri },
        ],
      }),
    );
    const texts = new TextMirror([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const readText = (uri: string): string | undefined => mirroredDocument(texts, uri)?.getText();
    const store = createProjectArtifacts({ inputs: await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      readText,
    ), readSnapshot: texts.readSnapshot,
    onInterpretationError: vi.fn(),
    interpretation, });
    store.symbolDiagnostics();
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
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].documents).toHaveLength(2);
  });

  it('maps warnings before failures per source and ignores unknown sources', async () => {
    const siblingUri = 'file:///abs/sibling.psl';
    const texts = new TextMirror([
      [schemaUri, cleanSource],
      [siblingUri, twoModelSource],
    ]);
    const { interpretation, spy } = interpretationDouble((_input, context) => {
      context.reportWarning?.({ code: 'W1', message: 'first', sourceId: schemaUri });
      context.reportWarning?.({ ...spanned, code: 'W2', sourceId: siblingUri });
      return notOk({
        summary: 'errors',
        diagnostics: [
          { ...spanned, code: 'E1' },
          { code: 'E2', message: 'second', sourceId: siblingUri },
          { code: 'E3', message: 'third', sourceId: schemaUri },
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
    const store = createProjectArtifacts({ inputs: await resolveSchemaInputs(
      {
        contract: { source: { format: 'psl', inputs: ['/abs/schema.psl', '/abs/sibling.psl'] } },
      },
      alwaysMember,
    ), readSnapshot: texts.readSnapshot,
    interpretation,
    onInterpretationError: vi.fn(), });
    store.symbolTable();
    const start = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const span = { start: { line: 2, character: 2 }, end: { line: 2, character: 8 } };
    expect(store.document(schemaUri)?.interpretDiagnostics()).toEqual([
      { code: 'W1', message: 'first', severity: 2, range: start },
      { code: 'E1', message: spanned.message, severity: 1, range: span },
      { code: 'E3', message: 'third', severity: 1, range: start },
    ]);
    expect(store.document(siblingUri)?.interpretDiagnostics()).toEqual([
      { code: 'W2', message: spanned.message, severity: 2, range: span },
      { code: 'E2', message: 'second', severity: 1, range: start },
    ]);
    store.document(schemaUri)?.interpretDiagnostics();
    expect(spy).toHaveBeenCalledTimes(1);
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
      documents: [artifacts?.document],
      sources: store.sources,
    });
    expect(input?.sources.sourceFileFor(input.documents[0]!.syntax)).toBe(artifacts?.sourceFile);
    expect(input?.symbolTable).toBeDefined();
    expect(context).toEqual({ ...interpretation.context, reportWarning: expect.any(Function) });
  });
});
