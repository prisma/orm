import type { PslDocumentAst, PslModel } from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { attr, makeNs, span } from './print-psl-from-ast.helpers';

describe('printPslFromAst', () => {
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

  it('renders model with leading comment', () => {
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
});
