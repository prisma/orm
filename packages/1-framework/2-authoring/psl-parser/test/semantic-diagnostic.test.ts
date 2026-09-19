import { expect, it } from 'vitest';
import { leafDiagnostic } from '../src/attribute-spec/combinators/diagnostic';
import {
  createPslDiagnosticCollector,
  diagnosticSource,
  type PslDiagnostic,
} from '../src/diagnostic';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';

it('creates attribute diagnostics directly from the owning syntax root', () => {
  const { document, sources } = parse('model User { id Int }', 'attributes.prisma');
  expect(leafDiagnostic({ sources }, document, 'Invalid attribute')).toEqual({
    filename: 'attributes.prisma',
    code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
    message: 'Invalid attribute',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } },
  });
});

it('maps ranges using their owning filename rather than the first registered source', () => {
  const first = parse('model A { id Int }', 'first.prisma');
  const second = parse('\n\nmodel B { id Int }', 'second.prisma');
  const sources = new PslSources([
    [first.document.syntax, first.sources.sourceFileFor(first.document.syntax)],
    [second.document.syntax, second.sources.sourceFileFor(second.document.syntax)],
  ]);
  const diagnostics = createPslDiagnosticCollector(sources);
  diagnostics.push(leafDiagnostic({ sources }, second.document, 'Invalid attribute'));
  expect(diagnostics.toExternal()).toEqual([
    {
      sourceId: 'second.prisma',
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      message: 'Invalid attribute',
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 20, line: 3, column: 19 },
      },
    },
  ]);
});

it('leaves located external diagnostics from unregistered files untouched', () => {
  const diagnostics = createPslDiagnosticCollector(new PslSources([]));
  const external = {
    code: 'EXTERNAL',
    message: 'Contributed diagnostic',
    sourceId: 'foreign.prisma',
    span: {
      start: { offset: 900, line: 42, column: 3 },
      end: { offset: 901, line: 42, column: 4 },
    },
    data: { contributed: true },
  };
  diagnostics.pushExternal(external);
  expect(diagnostics.toExternal()).toEqual([external]);
});

it('rejects ambiguous filenames during serialization instead of choosing the first file', () => {
  const first = parse('model A {}', 'same.prisma');
  const second = parse('\nmodel A {}', 'same.prisma');
  const sources = new PslSources([
    [first.document.syntax, first.sources.sourceFileFor(first.document.syntax)],
    [second.document.syntax, second.sources.sourceFileFor(second.document.syntax)],
  ]);
  const diagnostics = createPslDiagnosticCollector(sources);
  diagnostics.push(leafDiagnostic({ sources }, second.document, 'Invalid attribute'));
  expect(() => diagnostics.toExternal()).toThrow('Ambiguous PSL diagnostic filename');
});

it('preserves existing unlocated public envelopes while retaining owned internal ranges', () => {
  const { document, sources } = parse('model A {}', 'owned.prisma');
  const diagnostic = leafDiagnostic({ sources }, document, 'Invalid attribute');
  const diagnostics = createPslDiagnosticCollector(sources);
  diagnostics.pushUnlocated(diagnostic);
  expect(diagnostic.range).toEqual({
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  });
  expect(diagnostics.toExternal()).toEqual([
    { code: diagnostic.code, message: diagnostic.message, sourceId: 'owned.prisma' },
  ]);
});

it('creates file-local semantic diagnostics and preserves data at the output boundary', () => {
  const { document, sources } = parse('\nmodel User { id Int }', 'owned.prisma');
  const source = diagnosticSource(sources, document.syntax);
  const diagnostic: PslDiagnostic = {
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: 'Invalid argument',
    ...source.at({
      start: { offset: 7, line: 2, column: 7 },
      end: { offset: 11, line: 2, column: 11 },
    }),
    data: { namespace: 'extension' },
  };
  expect(diagnostic).toEqual({
    filename: 'owned.prisma',
    code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    message: 'Invalid argument',
    range: { start: { line: 1, character: 6 }, end: { line: 1, character: 10 } },
    data: { namespace: 'extension' },
  });
  const diagnostics = createPslDiagnosticCollector(sources);
  diagnostics.push(diagnostic);
  diagnostics.pushExternal({ code: 'EXTERNAL', message: 'Unlocated', sourceId: 'foreign.prisma' });
  diagnostics.push(diagnostic);
  expect(diagnostics.toExternal()).toEqual([
    {
      code: diagnostic.code,
      message: diagnostic.message,
      sourceId: 'owned.prisma',
      span: {
        start: { offset: 7, line: 2, column: 7 },
        end: { offset: 11, line: 2, column: 11 },
      },
      data: { namespace: 'extension' },
    },
    { code: 'EXTERNAL', message: 'Unlocated', sourceId: 'foreign.prisma' },
    {
      code: diagnostic.code,
      message: diagnostic.message,
      sourceId: 'owned.prisma',
      span: {
        start: { offset: 7, line: 2, column: 7 },
        end: { offset: 11, line: 2, column: 11 },
      },
      data: { namespace: 'extension' },
    },
  ]);
});
