import type {
  PslAttribute,
  PslCompositeType,
  PslDocumentAst,
  PslModel,
  PslNamedTypeDeclaration,
  PslNamespace,
  PslSpan,
  PslTypesBlock,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';

function span(off: number): PslSpan {
  return {
    start: { offset: off, line: 1, column: off + 1 },
    end: { offset: off + 1, line: 1, column: off + 2 },
  };
}

function attr(
  target: PslAttribute['target'],
  name: string,
  args: PslAttribute['args'],
  off: number,
): PslAttribute {
  return { kind: 'attribute', target, name, args, span: span(off) };
}

function makeNs(
  name: string,
  models: PslModel[],
  compositeTypes: PslCompositeType[],
  off: number,
): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(models, compositeTypes, []),
    span: span(off),
  });
}

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

  it('renders model with both fields and model-level attributes (separator blank line)', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'WithAttrs',
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
          attr('model', 'index', [{ kind: 'positional', value: '[id]', span: span(1) }], 2),
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
    const out = printPslFromAst(ast);
    expect(out).toContain('  id Int @id');
    expect(out).toContain('  @@index([id])');
    expect(out).toMatch(/ {2}id Int @id\n\n {2}@@index/);
  });

  it('renders model with leading comment and per-field comment', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Audit',
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
        comment: '// WARNING: legacy table',
      },
    ];
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, models, [], 0)],
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('// WARNING: legacy table');
    expect(out).toMatch(/\/\/ WARNING: legacy table\nmodel Audit \{/);
  });

  it('renders types block with attributes on a named type', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [],
      types: {
        kind: 'types',
        declarations: [
          {
            kind: 'namedType',
            name: 'Email',
            baseType: 'String',
            attributes: [
              attr(
                'namedType',
                'check',
                [{ kind: 'positional', value: '"len > 0"', span: span(0) }],
                1,
              ),
            ],
            span: span(0),
          },
        ],
        span: span(0),
      },
      span: span(0),
    };
    const out = printPslFromAst(ast);
    expect(out).toContain('Email = String @check("len > 0")');
  });

  it('renders field type with a typeConstructor (e.g. Money(2))', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Account',
        fields: [
          {
            kind: 'field',
            name: 'balance',
            typeName: 'Decimal',
            typeConstructor: {
              kind: 'typeConstructor',
              path: ['Money'],
              args: [{ kind: 'positional', value: '2', span: span(0) }],
              span: span(0),
            },
            optional: false,
            list: false,
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
    expect(printPslFromAst(ast)).toContain('balance Money(2)');
  });

  it('renders typeConstructor with no arguments (just a path)', () => {
    const ast: PslDocumentAst = {
      kind: 'document',
      sourceId: 't',
      namespaces: [],
      types: {
        kind: 'types',
        declarations: [
          {
            kind: 'namedType',
            name: 'Plain',
            typeConstructor: {
              kind: 'typeConstructor',
              path: ['Json'],
              args: [],
              span: span(0),
            },
            attributes: [],
            span: span(0),
          },
        ],
        span: span(0),
      },
      span: span(0),
    };
    expect(printPslFromAst(ast)).toContain('Plain = Json');
  });

  it('does not treat empty type-name strings as relations during topological sort', () => {
    const models: PslModel[] = [
      {
        kind: 'model',
        name: 'Edge',
        fields: [
          {
            kind: 'field',
            name: 'phantom',
            typeName: '',
            optional: false,
            list: false,
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
    expect(() => printPslFromAst(ast)).not.toThrow();
  });

  it('preserves @map values containing PSL escape sequences on print (no double-escape)', () => {
    // Parser-stored quoted literals keep escapes intact; printing must decode
    // once so `escapePslString` does not double-escape the output.
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
            name: 'body',
            typeName: 'String',
            optional: false,
            list: false,
            attributes: [
              attr(
                'field',
                'map',
                [
                  {
                    kind: 'positional',
                    value: '"with \\"quote\\" and \\\\backslash and \\nnewline"',
                    span: span(1),
                  },
                ],
                2,
              ),
            ],
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
    const printed = printPslFromAst(ast);
    expect(printed).toContain('@map("with \\"quote\\" and \\\\backslash and \\nnewline")');
  });

  it('prints a small two-model schema with a relation', () => {
    const models: PslModel[] = [
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
            name: 'email',
            typeName: 'String',
            optional: false,
            list: false,
            attributes: [attr('field', 'unique', [], 0)],
            span: span(0),
          },
          {
            kind: 'field',
            name: 'posts',
            typeName: 'Post',
            optional: false,
            list: true,
            attributes: [],
            span: span(0),
          },
        ],
        attributes: [],
        span: span(0),
      },
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
            span: span(0),
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
                  { kind: 'named', name: 'fields', value: '[authorId]', span: span(1) },
                  { kind: 'named', name: 'references', value: '[id]', span: span(2) },
                ],
                3,
              ),
            ],
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
    const printed = printPslFromAst(ast);
    expect(printed).toContain('model User {');
    expect(printed).toContain('model Post {');
    expect(printed).toContain('posts Post[]');
    expect(printed).toContain('@relation(fields: [authorId], references: [id])');
  });

  describe('namespace blocks', () => {
    function idModel(name: string): PslModel {
      return {
        kind: 'model',
        name,
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
      };
    }

    it('emits top-level declarations from the synthesised __unspecified__ bucket without a namespace wrapper', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, [idModel('A')], [], 0)],
        span: span(0),
      };
      const printed = printPslFromAst(ast);
      expect(printed).not.toMatch(/namespace\s+\w+\s*\{/);
      expect(printed).toContain('model A {');
    });

    it('prints a mixed top-level + namespaced schema with the top-level model unwrapped and the named namespace wrapped', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(UNSPECIFIED_PSL_NAMESPACE_ID, [idModel('TopLevel')], [], 0),
          makeNs('auth', [idModel('User')], [], 0),
        ],
        span: span(0),
      };
      const printed = printPslFromAst(ast);
      expect(printed).toMatch(/^model TopLevel \{/m);
      expect(printed).toContain('namespace auth {');
      expect(printed).toMatch(/namespace auth \{[\s\S]*model User \{/);
    });
  });

  describe('namespace ordering and escape handling', () => {
    it('sorts non-unspecified namespaces alphabetically', () => {
      function idModel(name: string): PslModel {
        return {
          kind: 'model',
          name,
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
        };
      }
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs('billing', [idModel('Invoice')], [], 0),
          makeNs('auth', [idModel('User')], [], 0),
        ],
        span: span(0),
      };
      const printed = printPslFromAst(ast);
      expect(printed.indexOf('namespace auth')).toBeLessThan(printed.indexOf('namespace billing'));
    });
  });

  describe('qualified field-type rendering', () => {
    // Helper: build a minimal AST with a single model containing one field.
    function astWithField(field: {
      name: string;
      typeName: string;
      typeNamespaceId?: string;
      typeContractSpaceId?: string;
    }): PslDocumentAst {
      return {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(
            UNSPECIFIED_PSL_NAMESPACE_ID,
            [
              {
                kind: 'model',
                name: 'Profile',
                fields: [
                  {
                    kind: 'field',
                    name: field.name,
                    typeName: field.typeName,
                    ...ifDefined('typeNamespaceId', field.typeNamespaceId),
                    ...ifDefined('typeContractSpaceId', field.typeContractSpaceId),
                    optional: true,
                    list: false,
                    attributes: [],
                    span: span(0),
                  },
                ],
                attributes: [],
                span: span(0),
              },
            ],
            [],
            0,
          ),
        ],
        span: span(0),
      };
    }

    it('renders a bare typeName without any qualifier (no regression)', () => {
      const out = printPslFromAst(astWithField({ name: 'user', typeName: 'User' }));
      // The field line must not contain a colon-prefix or dot qualifier.
      const fieldLine = out.split('\n').find((l) => l.includes('user') && l.includes('User'));
      expect(fieldLine).toBeDefined();
      expect(fieldLine).not.toContain(':');
      expect(fieldLine).not.toContain('.');
    });

    it('renders typeNamespaceId + typeName as ns.Name — TML-2459 gap fix', () => {
      // Before the fix, auth.User round-tripped back to bare User (the namespace was dropped).
      const out = printPslFromAst(
        astWithField({ name: 'user', typeName: 'User', typeNamespaceId: 'auth' }),
      );
      expect(out).toMatch(/user\s+auth\.User\?/);
    });

    it('renders typeContractSpaceId + typeNamespaceId + typeName as space:ns.Name', () => {
      const out = printPslFromAst(
        astWithField({
          name: 'user',
          typeName: 'User',
          typeNamespaceId: 'auth',
          typeContractSpaceId: 'supabase',
        }),
      );
      expect(out).toMatch(/user\s+supabase:auth\.User\?/);
    });

    it('renders typeContractSpaceId + typeName (no namespace) as space:Name', () => {
      const out = printPslFromAst(
        astWithField({ name: 'user', typeName: 'User', typeContractSpaceId: 'supabase' }),
      );
      expect(out).toMatch(/user\s+supabase:User\?/);
    });

    it('does not affect typeConstructor rendering', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(
            UNSPECIFIED_PSL_NAMESPACE_ID,
            [
              {
                kind: 'model',
                name: 'Account',
                fields: [
                  {
                    kind: 'field',
                    name: 'balance',
                    typeName: 'Decimal',
                    typeConstructor: {
                      kind: 'typeConstructor',
                      path: ['Money'],
                      args: [{ kind: 'positional', value: '2', span: span(0) }],
                      span: span(0),
                    },
                    optional: false,
                    list: false,
                    attributes: [],
                    span: span(0),
                  },
                ],
                attributes: [],
                span: span(0),
              },
            ],
            [],
            0,
          ),
        ],
        span: span(0),
      };
      expect(printPslFromAst(ast)).toContain('balance Money(2)');
    });

    it('prints a cross-space colon-prefix relation field with the qualifier intact', () => {
      const ast: PslDocumentAst = {
        kind: 'document',
        sourceId: 't',
        namespaces: [
          makeNs(
            UNSPECIFIED_PSL_NAMESPACE_ID,
            [
              {
                kind: 'model',
                name: 'Profile',
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
                    name: 'userId',
                    typeName: 'Int',
                    optional: false,
                    list: false,
                    attributes: [],
                    span: span(0),
                  },
                  {
                    kind: 'field',
                    name: 'user',
                    typeName: 'User',
                    typeNamespaceId: 'auth',
                    typeContractSpaceId: 'supabase',
                    optional: true,
                    list: false,
                    attributes: [
                      attr(
                        'field',
                        'relation',
                        [
                          { kind: 'named', name: 'fields', value: '[userId]', span: span(1) },
                          { kind: 'named', name: 'references', value: '[id]', span: span(2) },
                        ],
                        3,
                      ),
                    ],
                    span: span(0),
                  },
                ],
                attributes: [],
                span: span(0),
              },
            ],
            [],
            0,
          ),
        ],
        span: span(0),
      };
      const printed = printPslFromAst(ast);
      expect(printed).toContain('supabase:auth.User?');
      expect(printed).toMatch(/user\s+supabase:auth\.User\?\s+@relation/);
    });
  });
});
