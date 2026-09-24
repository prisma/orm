import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { enumMemberAttributeDiagnostics } from '../src/enum-member-attributes';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { claimedBlockKeywords, unsupportedBlockDiagnostic } from '../src/unclaimed-blocks';

const descriptors: AuthoringPslBlockDescriptorNamespace = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
  pack: {
    policy: {
      kind: 'pslBlock',
      keyword: 'policy',
      discriminator: 'policy',
      name: { required: true },
      parameters: {},
    },
  },
};

function blocksOf(source: string) {
  const { document, sources } = parse(source, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: descriptors,
  });
  return { blocks: symbolTable.topLevel.blocks, sources };
}

describe('claimedBlockKeywords', () => {
  it('claims the keywords of top-level descriptors, not of nested descriptor namespaces', () => {
    expect([...claimedBlockKeywords(descriptors)]).toEqual(['enum']);
  });

  it('claims nothing when no descriptors are composed', () => {
    expect([...claimedBlockKeywords(undefined)]).toEqual([]);
  });
});

describe('unsupportedBlockDiagnostic', () => {
  it('reports the block at its keyword', () => {
    const { blocks, sources } = blocksOf(
      'model User {\n  id Int\n}\n\nview Active {\n  id Int\n}\n',
    );
    expect(unsupportedBlockDiagnostic(blocks['Active']!, sources)).toEqual({
      filename: 'schema.prisma',
      code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
      message: 'Unsupported top-level block "view"',
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 4 } },
    });
  });
});

describe('enumMemberAttributeDiagnostics', () => {
  it('reports each attribute on an enum member at the attribute', () => {
    const { blocks, sources } = blocksOf(
      'enum Role {\n  USER @map("user") @deprecated\n  ADMIN\n}\n',
    );
    expect(enumMemberAttributeDiagnostics(blocks['Role']!, sources)).toEqual([
      {
        filename: 'schema.prisma',
        code: 'PSL_UNSUPPORTED_ENUM_MEMBER_ATTRIBUTE',
        message: 'enum "Role": member "USER" carries @map, but an enum member takes no attributes',
        range: { start: { line: 1, character: 7 }, end: { line: 1, character: 19 } },
      },
      {
        filename: 'schema.prisma',
        code: 'PSL_UNSUPPORTED_ENUM_MEMBER_ATTRIBUTE',
        message:
          'enum "Role": member "USER" carries @deprecated, but an enum member takes no attributes',
        range: { start: { line: 1, character: 20 }, end: { line: 1, character: 31 } },
      },
    ]);
  });

  it('reports nothing for members without attributes', () => {
    const { blocks, sources } = blocksOf('enum Role {\n  USER\n  ADMIN\n}\n');
    expect(enumMemberAttributeDiagnostics(blocks['Role']!, sources)).toEqual([]);
  });
});
