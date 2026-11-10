import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { UNSPECIFIED_PSL_NAMESPACE_ID } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';
import { makeNs, span } from './print-psl-from-ast.helpers';

describe('nullable list elements', () => {
  it.each([false, true])('prints element nullability with container optional=%s', (optional) => {
    const document: PslDocumentAst = {
      kind: 'document',
      sourceId: 'test',
      span: span(0),
      namespaces: [
        makeNs(
          UNSPECIFIED_PSL_NAMESPACE_ID,
          [
            {
              kind: 'model',
              name: 'Post',
              attributes: [],
              span: span(0),
              fields: [
                {
                  kind: 'field',
                  name: 'tags',
                  typeName: 'String',
                  optional,
                  list: true,
                  elementOptional: true,
                  attributes: [],
                  span: span(0),
                },
              ],
            },
          ],
          [],
          0,
        ),
      ],
    };
    expect(printPslFromAst(document)).toContain(`tags String?[]${optional ? '?' : ''}`);
  });
});
