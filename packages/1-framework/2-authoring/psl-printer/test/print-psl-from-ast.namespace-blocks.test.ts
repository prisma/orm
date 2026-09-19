import type { PslDocumentAst, PslModel } from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { attr, makeNs, span } from './print-psl-from-ast.helpers';

describe('printPslFromAst', () => {
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
});
