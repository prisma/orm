import type {
  PslDocumentAst,
  PslModel,
  PslNamedTypeDeclaration,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { attr, makeNs, span } from './print-psl-from-ast.helpers';

describe('printPslFromAst', () => {
  it('prints model with @id field', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'X',
        fields: [
          {
            kind: 'field',
            name: 'id',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [attr('field', 'id', [], 0)],
            span: span(0),
          },
        ],
        attributes: [],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('model X {\n  id Int @id');
  });

  it('prints @@map on model', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Foo',
        fields: [
          {
            kind: 'field',
            name: 'id',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [attr('field', 'id', [], 0)],
            span: span(0),
          },
        ],
        attributes: [
          attr('model', 'map', [{ kind: 'positional', value: '"foo"', span: span(1) }], 2),
        ],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@map("foo")');
  });

  it('prints types block', () => {
    const named: PslNamedTypeDeclaration = {
      kind: 'namedType',
      name: 'Money',
      baseType: 'Decimal',
      attributes: [],
      span: span(0),
    };
    const typesBlock: PslTypesBlock = {
      kind: 'types',
      declarations: [named],
      span: span(0),
    };
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [],
      types: typesBlock,
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('types {\n  Money = Decimal');
  });

  it('prints relation field with @relation', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Post',
        fields: [
          {
            kind: 'field',
            name: 'id',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [attr('field', 'id', [], 0)],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'authorId',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [],
            span: span(1),
          },
          {
            kind: 'field',
            name: 'author',
            typeName: 'User',
            optional: false,
            list: false,
            attributes: [
              attr(
                'field',
                'relation',
                [
                  { kind: 'named', name: 'fields', value: '[authorId]', span: span(2) },
                  { kind: 'named', name: 'references', value: '[id]', span: span(3) },
                ],
                4,
              ),
            ],
            span: span(5),
          },
        ],
        attributes: [],
        span: span(0),
      },
      {
        kind: 'model',
        name: 'User',
        fields: [
          {
            kind: 'field',
            name: 'id',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [attr('field', 'id', [], 0)],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'posts',
            typeName: 'Post',
            optional: false,
            list: true,
            attributes: [],
            span: span(1),
          },
        ],
        attributes: [],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };

    expect(printPslFromAst(ast)).toContain('@relation(fields: [authorId], references: [id])');
  });

  it('prints empty model', () => {
    const models: PslModel[] = [
      { kind: 'model', name: 'Empty', fields: [], attributes: [], span: span(0) },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toMatch(/model Empty \{\s*\}/s);
  });

  it('prints model with only model-level attributes', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'OnlyAttrs',
        fields: [],
        attributes: [
          attr('model', 'index', [{ kind: 'positional', value: '[a]', span: span(0) }], 1),
        ],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('@@index([a])');
  });

  it('renders optional and list type modifiers, plus @map on field', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Doc',
        fields: [
          {
            kind: 'field',
            name: 'id',
            typeName: 'Int',
            optional: false,
            list: false,
            attributes: [attr('field', 'id', [], 0)],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'nickname',
            typeName: 'String',
            optional: true,
            list: false,
            attributes: [
              attr(
                'field',
                'map',
                [{ kind: 'positional', value: '"nick_name"', span: span(1) }],
                2,
              ),
            ],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'tags',
            typeName: 'String',
            optional: false,
            list: true,
            attributes: [],
            span: span(0),
          },
        ],
        attributes: [],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toMatch(/nickname String\?\s+@map\("nick_name"\)/);
    expect(out).toMatch(/tags\s+String\[\]/);
  });

  it('renders a list-and-optional field as Type[]? and a required list as Type[]', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Doc',
        fields: [
          {
            kind: 'field',
            name: 'labels',
            typeName: 'String',
            optional: true,
            list: true,
            attributes: [],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'tags',
            typeName: 'String',
            optional: false,
            list: true,
            attributes: [],
            span: span(0),
          },
        ],
        attributes: [],
        span: span(0),
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toMatch(/labels\s+String\[\]\?/);
    expect(out).toMatch(/tags\s+String\[\]\s*$/m);
  });
});
