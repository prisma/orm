import { pathToFileURL } from 'node:url';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { computeDocumentDiagnostics } from '../src/document-diagnostics';
import { resolveSchemaInputs } from '../src/schema-inputs';

const schemaUri = pathToFileURL('/abs/schema.psl').toString();
const inputs = await resolveSchemaInputs(
  { contract: { source: { format: 'psl', inputs: ['/abs/schema.psl'] } } },
  () => '// use prisma-8\n',
);

const directive = '// use prisma-8';

describe('computeDocumentDiagnostics', () => {
  it('publishes parser diagnostics for a configured PSL input with a parse error', () => {
    const source = '// use prisma-8\nmodel {';
    const result = computeDocumentDiagnostics(schemaUri, source, inputs);
    expect(result).not.toBeNull();
    expect(result?.parseDiagnostics).toEqual(
      mapParseDiagnostics(parse(source, 'language-server-test.psl').diagnostics),
    );
    expect(result?.parseDiagnostics.length).toBeGreaterThan(0);
  });

  it('publishes an empty array for a clean configured PSL input', () => {
    const result = computeDocumentDiagnostics(
      schemaUri,
      '// use prisma-8\nmodel User {\n  id Int @id\n}\n',
      inputs,
    );
    expect(result?.parseDiagnostics).toEqual([]);
  });

  it('returns null for a document that is not a configured input', () => {
    const otherUri = pathToFileURL('/abs/not-a-schema.psl').toString();
    const result = computeDocumentDiagnostics(otherUri, 'model {', inputs);
    expect(result).toBeNull();
  });

  it('returns null for a configured input without the prisma-8 directive', () => {
    const result = computeDocumentDiagnostics(schemaUri, 'model {', inputs);
    expect(result).toBeNull();
  });

  it('exposes the parsed AST and source file as artifacts, with no symbol-table work', () => {
    const result = computeDocumentDiagnostics(
      schemaUri,
      '// use prisma-8\nmodel User {\n  id Int @id\n}\n',
      inputs,
    );
    expect(result?.document).toBeDefined();
    expect(result?.sourceFile).toBeDefined();
    expect(result).not.toHaveProperty('symbolTable');
  });

  it('does not report a duplicate top-level declaration — that is a project-level symbol-table concern', () => {
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

    const result = computeDocumentDiagnostics(schemaUri, duplicateModelSource, inputs);

    expect(result?.parseDiagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'PSL_DUPLICATE_DECLARATION',
    );
  });

  it('does not throw on a malformed, half-typed buffer', () => {
    expect(() =>
      computeDocumentDiagnostics(schemaUri, '// use prisma-8\nmodel User {\n  id ', inputs),
    ).not.toThrow();
  });
});
