import type { PslDocumentAst, PslModel } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { attr, makeNs, span } from './print-psl-from-ast.helpers';

describe('printPslFromAst', () => {
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
});
