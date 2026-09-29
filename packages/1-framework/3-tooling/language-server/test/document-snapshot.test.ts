import { parse } from '@internal/psl-parser/syntax';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentSnapshot } from '../src/document-snapshot';

vi.mock('@internal/psl-parser/syntax', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/psl-parser/syntax')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

afterEach(() => vi.mocked(parse).mockClear());

const uri = 'file:///workspace/schema.prisma';

describe('document snapshot', () => {
  it('parses lazily once and registers the root under the canonical URI', () => {
    const text = 'model User {\n  id Int @id\n}';
    const snapshot = createDocumentSnapshot('file:///workspace/%73chema.prisma', text);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.uri).toBe(uri);
    expect(snapshot.text).toBe(text);
    expect(snapshot.text).toBe(text);
    expect(parse).not.toHaveBeenCalled();
    const result = snapshot.parse();
    expect(snapshot.parse()).toBe(result);
    expect(parse).toHaveBeenCalledExactlyOnceWith(text, uri);
    expect(snapshot.sourceFile.filename).toBe(uri);
    expect(result.sources.sourceFileFor(result.document.syntax)).toBe(snapshot.sourceFile);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports an over-qualified field type as a raw parser diagnostic', () => {
    const result = createDocumentSnapshot(uri, 'model Profile {\n  user a.b.c\n}').parse();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'PSL_INVALID_QUALIFIED_NAME',
    );
  });

  it.each(['model {', 'model User {\n  id '])(
    'preserves malformed input artifacts and raw diagnostics: %s',
    (text) => {
      const expected = parse(text, uri);
      const result = createDocumentSnapshot(uri, text).parse();
      expect(result.document).toBeDefined();
      expect(result.sources.sourceFileFor(result.document.syntax)).toBeDefined();
      expect(result.sources).toBeDefined();
      expect(result.diagnostics).toEqual(expected.diagnostics);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).not.toHaveProperty('severity');
    },
  );
});
