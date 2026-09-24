import * as pslParser from '@internal/psl-parser';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { runPipeline } from '../src/pipeline';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime'] as const;
const pipelineInputs = { scalarTypes, pslBlockDescriptors: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPipeline', () => {
  it('registers the returned document root under the entry filename', () => {
    const source = ['model User {', '  id Int @id', '}'].join('\n');

    const result = runPipeline('file:///workspace/schema.prisma', source, pipelineInputs);

    expect(result.sourceFile.filename).toBe('file:///workspace/schema.prisma');
    expect(result.sources.sourceFileFor(result.document.syntax)).toBe(result.sourceFile);
  });

  it('reports a duplicate top-level declaration as PSL_DUPLICATE_DECLARATION', () => {
    const source = [
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model User {',
      '  id Int @id',
      '}',
    ].join('\n');

    const { diagnostics } = runPipeline('pipeline-test.psl', source, pipelineInputs);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('PSL_DUPLICATE_DECLARATION');
  });

  it('reports an over-qualified field type as PSL_INVALID_QUALIFIED_TYPE', () => {
    const source = ['model Profile {', '  user a.b.c', '}'].join('\n');

    const { diagnostics } = runPipeline('pipeline-test.psl', source, pipelineInputs);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_INVALID_QUALIFIED_TYPE',
    );
  });

  it('produces no symbol-table diagnostics for a clean schema', () => {
    const source = ['model User {', '  id Int @id', '}', ''].join('\n');

    const { diagnostics } = runPipeline('pipeline-test.psl', source, pipelineInputs);

    expect(diagnostics).toEqual([]);
  });

  it('does not throw on malformed, half-typed input and still exposes the artifacts', () => {
    const source = 'model User {\n  id ';

    const result = runPipeline('pipeline-test.psl', source, pipelineInputs);

    expect(result.document).toBeDefined();
    expect(result.sourceFile).toBeDefined();
    expect(result.symbolTable).toBeDefined();
  });

  it('builds the symbol table once and returns the table and diagnostics from that result', () => {
    const source = [
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model User {',
      '  id Int @id',
      '}',
    ].join('\n');
    const { diagnostics: parseDiagnostics } = parse(source, 'pipeline-test.psl');
    const buildSymbolTableSpy = vi.spyOn(pslParser, 'buildSymbolTable');

    const result = runPipeline('pipeline-test.psl', source, pipelineInputs);
    const [symbolTableCallResult] = buildSymbolTableSpy.mock.results;

    expect(buildSymbolTableSpy).toHaveBeenCalledTimes(1);
    expect(symbolTableCallResult?.type).toBe('return');
    if (symbolTableCallResult === undefined || symbolTableCallResult.type !== 'return') {
      throw new Error('expected buildSymbolTable to return');
    }
    expect(result.symbolTable).toBe(symbolTableCallResult.value.symbolTable);
    expect(result.diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableCallResult.value.diagnostics]),
    );
  });

  it('merges parse then symbol-table diagnostics, mapped the same way the build composes them', () => {
    const source = [
      'model User {',
      '  id Int @id',
      '}',
      '',
      'model User {',
      '  id Int @id',
      '}',
    ].join('\n');

    const { document, sources, diagnostics: parseDiagnostics } = parse(source, 'pipeline-test.psl');
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: {},
    });

    const { diagnostics } = runPipeline('pipeline-test.psl', source, pipelineInputs);

    expect(diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });
});
