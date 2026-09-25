import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { mapParseDiagnostics } from '../src/diagnostic-mapping';
import { runPipeline } from '../src/pipeline';

describe('runPipeline', () => {
  it('registers the returned document root under the entry filename', () => {
    const source = ['model User {', '  id Int @id', '}'].join('\n');

    const result = runPipeline('file:///workspace/schema.prisma', source);

    expect(result.sourceFile.filename).toBe('file:///workspace/schema.prisma');
    expect(result.sources.sourceFileFor(result.document.syntax)).toBe(result.sourceFile);
  });

  it('reports an over-qualified field type as a parse diagnostic', () => {
    const source = ['model Profile {', '  user a.b.c', '}'].join('\n');

    const { parseDiagnostics } = runPipeline('pipeline-test.psl', source);

    expect(parseDiagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_INVALID_QUALIFIED_NAME',
    );
  });

  it('produces no parse diagnostics for a clean schema', () => {
    const source = ['model User {', '  id Int @id', '}', ''].join('\n');

    const { parseDiagnostics } = runPipeline('pipeline-test.psl', source);

    expect(parseDiagnostics).toEqual([]);
  });

  it('does not throw on malformed, half-typed input and still exposes the artifacts', () => {
    const source = 'model User {\n  id ';

    const result = runPipeline('pipeline-test.psl', source);

    expect(result.document).toBeDefined();
    expect(result.sourceFile).toBeDefined();
    expect(result.sources).toBeDefined();
  });

  it('maps parse diagnostics the same way the build maps them', () => {
    const source = 'model {';
    const { diagnostics: rawParseDiagnostics } = parse(source, 'pipeline-test.psl');

    const { parseDiagnostics } = runPipeline('pipeline-test.psl', source);

    expect(parseDiagnostics).toEqual(mapParseDiagnostics(rawParseDiagnostics));
    expect(parseDiagnostics.length).toBeGreaterThan(0);
  });
});
