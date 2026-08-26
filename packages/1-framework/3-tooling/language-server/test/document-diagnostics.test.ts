import { pathToFileURL } from 'node:url';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { computeDocumentDiagnostics } from '../src/document-diagnostics';
import type { PipelineInputs } from '../src/pipeline';
import { resolveSchemaInputs } from '../src/schema-inputs';

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const inputs = resolveSchemaInputs({
  contract: { source: { format: 'psl', inputs: ['/abs/schema.psl'] } },
});

const controlStack: PipelineInputs = {
  scalarTypes: ['String', 'Int', 'Boolean', 'DateTime'],
  pslBlockDescriptors: {},
};

const directive = '// use prisma-next';

const duplicateModelSource = [
  directive,
  'model User {',
  '  id Int @id',
  '}',
  '',
  'model User {',
  '  id Int @id',
  '}',
].join('\n');

describe('computeDocumentDiagnostics', () => {
  it('publishes parser diagnostics for a configured PSL input with a parse error', () => {
    const source = '// use prisma-next\nmodel {';
    const result = computeDocumentDiagnostics(schemaUri, source, inputs, controlStack);
    expect(result).not.toBeNull();
    expect(result?.diagnostics).toEqual(mapParseDiagnostics(parse(source).diagnostics));
    expect(result?.diagnostics.length).toBeGreaterThan(0);
  });

  it('publishes an empty array for a clean configured PSL input', () => {
    const result = computeDocumentDiagnostics(
      schemaUri,
      '// use prisma-next\nmodel User {\n  id Int @id\n}\n',
      inputs,
      controlStack,
    );
    expect(result?.diagnostics).toEqual([]);
  });

  it('returns null for a document that is not a configured input', () => {
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    const result = computeDocumentDiagnostics(otherUri, 'model {', inputs, controlStack);
    expect(result).toBeNull();
  });

  it('returns null for a configured input without the prisma-next directive', () => {
    const result = computeDocumentDiagnostics(schemaUri, 'model {', inputs, controlStack);
    expect(result).toBeNull();
  });

  it('runs the symbol-table tier and reports a duplicate top-level declaration', () => {
    const result = computeDocumentDiagnostics(
      schemaUri,
      duplicateModelSource,
      inputs,
      controlStack,
    );
    expect(result?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
  });

  it('matches the merged parse + symbol-table diagnostics for the same inputs', () => {
    const source = [directive, 'model Profile {', '  user a.b.c', '}'].join('\n');
    const { document, sourceFile, diagnostics: parseDiagnostics } = parse(source);
    const { diagnostics: symbolTableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: controlStack.pslBlockDescriptors,
    });

    const result = computeDocumentDiagnostics(schemaUri, source, inputs, controlStack);

    expect(result?.diagnostics).toEqual(
      mapParseDiagnostics([...parseDiagnostics, ...symbolTableDiagnostics]),
    );
  });

  it('exposes the parsed AST and the symbol table as artifacts', () => {
    const result = computeDocumentDiagnostics(
      schemaUri,
      '// use prisma-next\nmodel User {\n  id Int @id\n}\n',
      inputs,
      controlStack,
    );
    expect(result?.document).toBeDefined();
    expect(result?.sourceFile).toBeDefined();
    expect(result?.symbolTable).toBeDefined();
  });

  it('returns null for a document that is not a configured input', () => {
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    expect(
      computeDocumentDiagnostics(otherUri, duplicateModelSource, inputs, controlStack),
    ).toBeNull();
  });

  it('does not throw on a malformed, half-typed buffer', () => {
    expect(() =>
      computeDocumentDiagnostics(
        schemaUri,
        '// use prisma-next\nmodel User {\n  id ',
        inputs,
        controlStack,
      ),
    ).not.toThrow();
  });
});
