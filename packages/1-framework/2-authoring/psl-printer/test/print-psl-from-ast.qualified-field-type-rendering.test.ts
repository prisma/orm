import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { attr, makeNs, span } from './print-psl-from-ast.helpers';

describe('printPslFromAst', () => {
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
