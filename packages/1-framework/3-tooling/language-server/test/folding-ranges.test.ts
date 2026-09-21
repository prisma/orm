import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { FoldingRangeKind } from 'vscode-languageserver';
import { computeFoldingRanges } from '../src/folding-ranges';

describe('computeFoldingRanges', () => {
  it('returns one range for a model declaration', () => {
    const source = `model User {
  id Int @id
  email String
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 3, kind: FoldingRangeKind.Region }]);
  });

  it('returns one range for a composite type declaration', () => {
    const source = `type Address {
  street String
  city String
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 3, kind: FoldingRangeKind.Region }]);
  });

  it('returns one range for a flat namespace declaration', () => {
    const source = `namespace billing {
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 1, kind: FoldingRangeKind.Region }]);
  });

  it('returns two ranges for a namespace with a model inside', () => {
    const source = `namespace billing {
  model Invoice {
    id Int @id
  }
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([
      { startLine: 0, endLine: 4, kind: FoldingRangeKind.Region },
      { startLine: 1, endLine: 3, kind: FoldingRangeKind.Region },
    ]);
  });

  it('returns one range for a generator block', () => {
    const source = `generator client {
  provider = "prisma-client-js"
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 2, kind: FoldingRangeKind.Region }]);
  });

  it('returns one range for a datasource block', () => {
    const source = `datasource db {
  provider = "postgresql"
  url = env("DATABASE_URL")
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 3, kind: FoldingRangeKind.Region }]);
  });

  it('returns one range for a types block', () => {
    const source = `types {
  MyInt = Int
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([{ startLine: 0, endLine: 2, kind: FoldingRangeKind.Region }]);
  });

  it('returns an empty array for an empty document', () => {
    const source = '';
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([]);
  });

  it('returns an empty array for a document with only comments', () => {
    const source = `// This is a comment
// Another comment`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([]);
  });

  it('returns an empty array for a document with only whitespace', () => {
    const source = '   \n\n   ';
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([]);
  });

  it('returns multiple ranges for a document with several block types', () => {
    const source = `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}

type Address {
  street String
}`;
    const { document, sources } = parse(source, 'language-server-test.psl');
    const ranges = computeFoldingRanges(document, sources);

    expect(ranges).toEqual([
      { startLine: 0, endLine: 2, kind: FoldingRangeKind.Region },
      { startLine: 4, endLine: 6, kind: FoldingRangeKind.Region },
      { startLine: 8, endLine: 10, kind: FoldingRangeKind.Region },
    ]);
  });
});
