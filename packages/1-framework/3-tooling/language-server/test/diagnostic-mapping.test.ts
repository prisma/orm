import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { parse, SourceFile } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  mapInterpreterDiagnostics,
  mapParseDiagnostics,
  ParseDiagnosticSeverity,
} from '../src/diagnostic-mapping';

describe('mapParseDiagnostics', () => {
  it('passes the parser range through unchanged', () => {
    const source = 'model {';
    const { diagnostics } = parse(source, 'language-server-test.psl');
    expect(diagnostics.length).toBeGreaterThan(0);

    const mapped = mapParseDiagnostics(diagnostics);

    expect(mapped).toHaveLength(diagnostics.length);
    for (const [index, mappedDiagnostic] of mapped.entries()) {
      const source = diagnostics[index];
      expect(mappedDiagnostic.range).toEqual(source?.range);
      expect(mappedDiagnostic.message).toBe(source?.message);
      expect(mappedDiagnostic.code).toBe(source?.code);
      expect(mappedDiagnostic.severity).toBe(ParseDiagnosticSeverity.Error);
    }
  });

  it('returns an empty array for a clean parse', () => {
    const { diagnostics } = parse('model User {\n  id Int @id\n}\n', 'language-server-test.psl');
    expect(diagnostics).toHaveLength(0);
    expect(mapParseDiagnostics(diagnostics)).toEqual([]);
  });
});

describe('mapInterpreterDiagnostics', () => {
  const text = 'model User {\n  id Int @id\n  posts Post[]\n}\n';
  const sourceFile = new SourceFile('diagnostic-mapping-test.psl', text);

  it('maps a span to a 0-based LSP range (hand-computed)', () => {
    // Offsets 28..33 sit on the third line ("  posts Post[]"), landing on
    // "posts": 0-based positions {2,2}..{2,7}.
    const diagnostic: ContractSourceDiagnostic = {
      code: 'PSL_UNRESOLVED_RELATION',
      message: 'relation target not found',
      sourceId: 'diagnostic-mapping-test.psl',
      span: {
        start: { offset: 28, line: 3, column: 3 },
        end: { offset: 33, line: 3, column: 8 },
      },
    };

    const [mapped] = mapInterpreterDiagnostics([diagnostic], sourceFile);

    expect(mapped).toEqual({
      range: { start: { line: 2, character: 2 }, end: { line: 2, character: 7 } },
      message: 'relation target not found',
      code: 'PSL_UNRESOLVED_RELATION',
      severity: ParseDiagnosticSeverity.Error,
    });
  });

  it('inverts rangeToPslSpan for a span produced from a real source file', () => {
    const range = { start: { line: 2, character: 2 }, end: { line: 2, character: 7 } };
    const span = sourceFile.rangeToPslSpan(range);

    const [mapped] = mapInterpreterDiagnostics(
      [{ code: 'PSL_DEMO', message: 'demo', sourceId: 'diagnostic-mapping-test.psl', span }],
      sourceFile,
    );

    expect(mapped?.range).toEqual(range);
  });

  it('anchors a span-less diagnostic at document start instead of dropping it', () => {
    const [mapped] = mapInterpreterDiagnostics(
      [
        {
          code: 'PSL_SPANLESS',
          message: 'no span available',
          sourceId: 'diagnostic-mapping-test.psl',
        },
      ],
      sourceFile,
    );

    expect(mapped).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'no span available',
      code: 'PSL_SPANLESS',
      severity: ParseDiagnosticSeverity.Error,
    });
  });
});
