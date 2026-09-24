import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';

describe('PslSources.merge', () => {
  it('unites per-document sources into one registry addressable by either document', () => {
    const first = parse('model User { id Int }', 'a.prisma');
    const second = parse('model Post { id Int }', 'b.prisma');

    const merged = PslSources.merge([first, second]);

    expect(merged.sourceFileFor(first.document.syntax).filename).toBe('a.prisma');
    expect(merged.sourceFileFor(second.document.syntax).filename).toBe('b.prisma');
    expect(merged.sourceFileNamed('a.prisma').filename).toBe('a.prisma');
    expect(merged.sourceFileNamed('b.prisma').filename).toBe('b.prisma');
  });

  it('returns an empty registry for no documents', () => {
    const merged = PslSources.merge([]);

    expect(() => merged.sourceFileNamed('anything.prisma')).toThrow();
  });
});
