import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { mergePslSources } from '../src/source-file';

describe('mergePslSources', () => {
  it('unites per-document sources into one registry addressable by either document', () => {
    const first = parse('model User { id Int }', 'a.prisma');
    const second = parse('model Post { id Int }', 'b.prisma');

    const merged = mergePslSources([first, second]);

    expect(merged.sourceFileFor(first.document.syntax).filename).toBe('a.prisma');
    expect(merged.sourceFileFor(second.document.syntax).filename).toBe('b.prisma');
    expect(merged.sourceFileNamed('a.prisma').filename).toBe('a.prisma');
    expect(merged.sourceFileNamed('b.prisma').filename).toBe('b.prisma');
  });

  it('returns an empty registry for no documents', () => {
    const merged = mergePslSources([]);

    expect(() => merged.sourceFileNamed('anything.prisma')).toThrow();
  });
});
