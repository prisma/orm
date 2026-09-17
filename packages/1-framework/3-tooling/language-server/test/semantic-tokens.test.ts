import { buildSymbolTable, type SymbolTable } from '@internal/psl-parser';
import { type DocumentAst, parse, SourceFile } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import {
  buildSemanticTokens,
  collectSemanticTokenEvents,
  type PendingSemanticToken,
  type SemanticTokenModifier,
  SemanticTokensBuilder,
  type SemanticTokenType,
  semanticTokenModifierBits,
  semanticTokenModifierIndexes,
  semanticTokenModifiers,
  semanticTokensLegend,
  semanticTokenTypes,
} from '../src/semantic-tokens';

const scalarTypes = ['String', 'Int', 'Boolean', 'DateTime', 'Float', 'Json'] as const;

interface ParsedSemanticTokenSource {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly symbolTable: SymbolTable;
  readonly scalarTypes: readonly string[];
}

interface TokenDetails {
  readonly text: string;
  readonly tokenType: SemanticTokenType;
  readonly modifiers: readonly SemanticTokenModifier[];
  readonly line: number;
  readonly character: number;
}

function parseSemanticTokenSource(source: string): ParsedSemanticTokenSource {
  const { document, sources } = parse(source, 'language-server-test.psl');
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return { document, sourceFile, symbolTable, scalarTypes };
}

function collectDetails(source: ParsedSemanticTokenSource): readonly TokenDetails[] {
  return decodeSemanticTokens(source.sourceFile, buildSemanticTokens(source).data);
}

function decodeSemanticTokens(
  sourceFile: SourceFile,
  data: readonly number[],
): readonly TokenDetails[] {
  const details: TokenDetails[] = [];
  let line = 0;
  let character = 0;

  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index] ?? 0;
    const deltaStart = data[index + 1] ?? 0;
    const length = data[index + 2] ?? 0;
    const tokenTypeIndex = data[index + 3] ?? 0;
    const modifierBitset = data[index + 4] ?? 0;

    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;
    const startOffset = sourceFile.offsetAt({ line, character });
    details.push({
      text: sourceFile.text.slice(startOffset, startOffset + length),
      tokenType: semanticTokenTypeAt(tokenTypeIndex),
      modifiers: tokenModifiersFromBitset(modifierBitset),
      line,
      character,
    });
  }

  return details;
}

function semanticTokenTypeAt(index: number): SemanticTokenType {
  const tokenType = semanticTokenTypes[index];
  if (tokenType === undefined) {
    throw new Error(`Unknown semantic token type index ${index}`);
  }
  return tokenType;
}

function pendingToken(
  startOffset: number,
  endOffset: number,
  tokenType: SemanticTokenType,
  modifierBitset = 0,
  splitMultiline = false,
): PendingSemanticToken {
  return {
    startOffset,
    endOffset,
    tokenTypeIndex: semanticTokenTypes.indexOf(tokenType),
    modifierBitset,
    splitMultiline,
  };
}

function encodeWithBuilder(
  sourceFile: SourceFile,
  tokens: readonly PendingSemanticToken[],
  range?: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  },
): { readonly data: readonly number[] } {
  const builder = new SemanticTokensBuilder(sourceFile, range);
  for (const token of tokens) {
    builder.add(token);
  }
  return builder.build();
}

function tokenModifiersFromBitset(modifierBitset: number): readonly SemanticTokenModifier[] {
  const modifiers: SemanticTokenModifier[] = [];
  if ((modifierBitset & semanticTokenModifierBits.declaration) !== 0) {
    modifiers.push(semanticTokenModifiers[semanticTokenModifierIndexes.declaration]);
  }
  if ((modifierBitset & semanticTokenModifierBits.defaultLibrary) !== 0) {
    modifiers.push(semanticTokenModifiers[semanticTokenModifierIndexes.defaultLibrary]);
  }
  return modifiers;
}

function findToken(
  details: readonly TokenDetails[],
  expected: Pick<TokenDetails, 'text' | 'tokenType'> & {
    readonly modifiers?: readonly SemanticTokenModifier[];
  },
): TokenDetails | undefined {
  return details.find(
    (token) =>
      token.text === expected.text &&
      token.tokenType === expected.tokenType &&
      (expected.modifiers === undefined || sameModifiers(token.modifiers, expected.modifiers)),
  );
}

function sameModifiers(
  actual: readonly SemanticTokenModifier[],
  expected: readonly SemanticTokenModifier[],
): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((modifier) => actual.includes(modifier));
}

describe('semantic token substrate', () => {
  it('keeps the semantic token legend stable', () => {
    expect(semanticTokenTypes).toEqual([
      'keyword',
      'namespace',
      'class',
      'struct',
      'type',
      'property',
      'decorator',
      'string',
      'number',
      'comment',
    ]);
    expect(semanticTokenModifiers).toEqual(['declaration', 'defaultLibrary']);
    expect(semanticTokensLegend).toEqual({
      tokenTypes: [...semanticTokenTypes],
      tokenModifiers: [...semanticTokenModifiers],
    });
  });

  it('classifies a representative document from parser artifacts', () => {
    const source = parseSemanticTokenSource(
      [
        '// leading comment',
        'namespace billing {',
        '  model Invoice {',
        '    id Int @id',
        '    customer User? @relation(name: "invoice_user", fields: [id])',
        '    amount Decimal @default(12.5)',
        '    active Boolean @default(true)',
        '    metadata Json',
        '    shipping Address',
        '    @@map("invoices")',
        '  }',
        '',
        '  type Address {',
        '    street String',
        '  }',
        '',
        '  policy InvoiceAccess {',
        '    target = Invoice',
        '    active = true',
        '    retries = 3',
        '    label = "default"',
        '    nested = { mode: read, ttl: 30 }',
        '  }',
        '}',
        '',
        'model User {',
        '  id Int @id',
        '}',
        '',
        'types {',
        '  Decimal = Float',
        '  Identifier = String @map("id")',
        '}',
      ].join('\n'),
    );

    const details = collectDetails(source);

    expect(findToken(details, { text: '// leading comment', tokenType: 'comment' })).toBeDefined();
    expect(findToken(details, { text: 'namespace', tokenType: 'keyword' })).toBeDefined();
    expect(
      findToken(details, {
        text: 'billing',
        tokenType: 'namespace',
        modifiers: ['declaration'],
      }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Invoice', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'User', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'User', tokenType: 'class' })).toBeDefined();
    expect(
      findToken(details, { text: 'Address', tokenType: 'struct', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'Address', tokenType: 'struct' })).toBeDefined();
    expect(
      findToken(details, { text: 'InvoiceAccess', tokenType: 'type', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Decimal', tokenType: 'type', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Decimal', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'String', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Int', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(
      findToken(details, { text: 'Boolean', tokenType: 'type', modifiers: ['defaultLibrary'] }),
    ).toBeDefined();
    expect(findToken(details, { text: 'id', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'customer', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'target', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'mode', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: 'ttl', tokenType: 'property' })).toBeDefined();
    expect(findToken(details, { text: '@relation', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '@@map', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '"invoice_user"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: '"default"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: '12.5', tokenType: 'number' })).toBeDefined();
    expect(findToken(details, { text: '30', tokenType: 'number' })).toBeDefined();
    expect(findToken(details, { text: 'true', tokenType: 'keyword' })).toBeDefined();
    expect(details.filter((token) => token.text === '"invoice_user"')).toHaveLength(1);
    expect(details.filter((token) => token.text === '12.5')).toHaveLength(1);
  });

  it('classifies relation field-list identifiers as properties', () => {
    const source = parseSemanticTokenSource(
      [
        'model Post {',
        '  authorId Int',
        '  author User @relation(fields: [authorId], references: [id])',
        '}',
        '',
        'model User {',
        '  id Int @id',
        '}',
      ].join('\n'),
    );

    const details = collectDetails(source);

    expect(
      details.filter((token) => token.text === 'authorId' && token.tokenType === 'property'),
    ).toHaveLength(2);
    expect(
      details.filter((token) => token.text === 'id' && token.tokenType === 'property'),
    ).toHaveLength(2);
    expect(
      details.find((token) => token.text === 'authorId' && token.tokenType === 'type'),
    ).toBeUndefined();
    expect(
      details.find((token) => token.text === 'id' && token.tokenType === 'type'),
    ).toBeUndefined();
  });

  it('preserves source order when block attributes precede fields', () => {
    const source = parseSemanticTokenSource(
      ['model User {', '  @@map("users")', '  id Int @id', '}'].join('\n'),
    );

    const encoded = buildSemanticTokens(source);
    const details = decodeSemanticTokens(source.sourceFile, encoded.data);

    expect(details.map((token) => token.text)).toEqual([
      'model',
      'User',
      '@@map',
      '"users"',
      'id',
      'Int',
      '@id',
    ]);
    for (let index = 0; index < encoded.data.length; index += 5) {
      expect(encoded.data[index]).toBeGreaterThanOrEqual(0);
      expect(encoded.data[index + 1]).toBeGreaterThanOrEqual(0);
    }
  });

  it('filters encoded tokens to an intersecting source range', () => {
    const source = parseSemanticTokenSource(
      ['model User {', '  id Int @id', '}', '', 'type Address {', '  street String', '}'].join(
        '\n',
      ),
    );

    const encoded = buildSemanticTokens(source, {
      start: { line: 0, character: 0 },
      end: { line: 3, character: 0 },
    });
    const details = decodeSemanticTokens(source.sourceFile, encoded.data);

    expect(details.map((token) => token.text)).toEqual(['model', 'User', 'id', 'Int', '@id']);
    expect(encoded.data.length % 5).toBe(0);
    for (let index = 0; index < encoded.data.length; index += 5) {
      expect(encoded.data[index]).toBeGreaterThanOrEqual(0);
      expect(encoded.data[index + 1]).toBeGreaterThanOrEqual(0);
      expect(encoded.data[index + 2]).toBeGreaterThan(0);
    }
  });

  it('encodes ordered LSP five-integer token data', () => {
    const sourceFile = new SourceFile('language-server-test.psl', 'aaa bbb\ncc');
    const tokens: readonly PendingSemanticToken[] = [
      pendingToken(0, 3, 'keyword'),
      pendingToken(4, 7, 'class', semanticTokenModifierBits.declaration),
      pendingToken(8, 10, 'type', semanticTokenModifierBits.defaultLibrary),
    ];

    expect(encodeWithBuilder(sourceFile, tokens)).toEqual({
      data: [0, 0, 3, 0, 0, 0, 4, 3, 2, 1, 1, 0, 2, 4, 2],
    });
  });

  it('splits multiline text token events before encoding', () => {
    const sourceFile = new SourceFile('language-server-test.psl', 'aa\nbbb\ncc');
    const tokens: readonly PendingSemanticToken[] = [
      pendingToken(0, sourceFile.length, 'string', 0, true),
    ];

    expect(encodeWithBuilder(sourceFile, tokens)).toEqual({
      data: [0, 0, 2, 7, 0, 1, 0, 3, 7, 0, 1, 0, 2, 7, 0],
    });
  });

  it('filters split multiline text token segments to the requested range', () => {
    const sourceFile = new SourceFile('language-server-test.psl', 'aa\nbbb\ncc');
    const tokens: readonly PendingSemanticToken[] = [
      pendingToken(0, sourceFile.length, 'string', 0, true),
    ];

    expect(
      encodeWithBuilder(sourceFile, tokens, {
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 },
      }),
    ).toEqual({ data: [1, 0, 3, 7, 0] });
  });

  it('does not split multiline structural token events before encoding', () => {
    const sourceFile = new SourceFile('language-server-test.psl', 'aa\nbbb\ncc');
    const tokens: readonly PendingSemanticToken[] = [pendingToken(0, sourceFile.length, 'class')];

    expect(encodeWithBuilder(sourceFile, tokens)).toEqual({ data: [0, 0, 9, 2, 0] });
  });

  it('combines modifier bitsets deterministically', () => {
    const sourceFile = new SourceFile('language-server-test.psl', 'Scalar');
    const tokens: readonly PendingSemanticToken[] = [
      pendingToken(
        0,
        6,
        'type',
        semanticTokenModifierBits.declaration | semanticTokenModifierBits.defaultLibrary,
      ),
    ];

    expect(encodeWithBuilder(sourceFile, tokens)).toEqual({ data: [0, 0, 6, 4, 3] });
  });

  it('returns deterministic output for identical artifacts', () => {
    const sourceText = ['model User {', '  id Int @id', '  name String', '}'].join('\n');
    const first = parseSemanticTokenSource(sourceText);
    const second = parseSemanticTokenSource(sourceText);

    expect(collectSemanticTokenEvents(first)).toEqual(collectSemanticTokenEvents(second));
    expect(buildSemanticTokens(first)).toEqual(buildSemanticTokens(second));
  });

  it('recovers semantic tokens from malformed input', () => {
    const source = parseSemanticTokenSource(
      [
        '// recoverable comment',
        'model User {',
        '  id Int @id',
        '  name String @default("anonymous"',
        '  active Boolean @default(true)',
      ].join('\n'),
    );

    expect(() => buildSemanticTokens(source)).not.toThrow();
    const details = collectDetails(source);

    expect(
      findToken(details, { text: '// recoverable comment', tokenType: 'comment' }),
    ).toBeDefined();
    expect(findToken(details, { text: 'model', tokenType: 'keyword' })).toBeDefined();
    expect(
      findToken(details, { text: 'User', tokenType: 'class', modifiers: ['declaration'] }),
    ).toBeDefined();
    expect(findToken(details, { text: '@id', tokenType: 'decorator' })).toBeDefined();
    expect(findToken(details, { text: '"anonymous"', tokenType: 'string' })).toBeDefined();
    expect(findToken(details, { text: 'true', tokenType: 'keyword' })).toBeDefined();
  });
});
