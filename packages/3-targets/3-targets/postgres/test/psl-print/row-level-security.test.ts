import { expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { buildPolicyBlocks } from '../../src/core/psl-print/row-level-security';

it('writes policy expressions without changing references, role order, or escaping', () => {
  const [block] = buildPolicyBlocks({
    namespaceId: 'public',
    entries: {
      read: new PostgresRlsPolicy({
        naming: { kind: 'exact', name: 'read policy' },
        namespaceId: 'public',
        tableName: 'widgets',
        operation: 'all',
        roles: ['writer', 'reader'],
        using: '"owner" = \'a\\b\'\n',
        withCheck: '"active" = true',
        permissive: false,
      }),
    },
    modelNameForTable: () => 'public.Widget',
    rlsTables: new Set(['widgets']),
  });
  expect(block?.parameters).toEqual({
    target: { expression: 'public.Widget', span: expect.any(Object) },
    roles: { expression: '[writer, reader]', span: expect.any(Object) },
    using: { expression: JSON.stringify('"owner" = \'a\\b\'\n'), span: expect.any(Object) },
    withCheck: { expression: JSON.stringify('"active" = true'), span: expect.any(Object) },
    permissive: { expression: 'false', span: expect.any(Object) },
  });
  expect(block?.blockAttributes).toEqual([
    {
      name: 'map',
      args: [{ kind: 'positional', value: '"read policy"', span: expect.any(Object) }],
      span: expect.any(Object),
    },
  ]);
  expect(block).not.toHaveProperty('attributes');
});
