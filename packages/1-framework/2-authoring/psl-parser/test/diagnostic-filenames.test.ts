import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

describe('diagnostic filenames', () => {
  it('includes the owning filename and source-local range in parser errors', () => {
    const { diagnostics } = parse('model User', 'nested/users.prisma');
    expect(diagnostics).toEqual([
      {
        filename: 'nested/users.prisma',
        code: 'PSL_INVALID_DECLARATION',
        message: 'Expected "{" to open the "model" block',
        range: {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 10 },
        },
      },
    ]);
  });

  it('identifies the second document when duplicate declarations have equal offsets', () => {
    const first = parse('model User { id Int }', 'first.prisma');
    const second = parse('model User { id Int }', 'nested/second.prisma');
    const sources = new PslSources([
      [first.document.syntax, first.sources.sourceFileFor(first.document.syntax)],
      [second.document.syntax, second.sources.sourceFileFor(second.document.syntax)],
    ]);
    const { diagnostics } = buildSymbolTable({
      documents: [first.document, second.document],
      sources,
      pslBlockDescriptors: {},
    });
    expect(diagnostics).toEqual([
      {
        filename: 'nested/second.prisma',
        code: 'PSL_DUPLICATE_DECLARATION',
        message: 'Duplicate declaration of "User"',
        range: {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 10 },
        },
      },
    ]);
  });
});
