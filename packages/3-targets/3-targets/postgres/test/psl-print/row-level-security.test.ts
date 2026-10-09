import { expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { buildPolicyBlocks } from '../../src/core/psl-print/row-level-security';

it('writes policy expressions as sql literals without changing references or role order', () => {
  const [block] = buildPolicyBlocks({
    namespaceId: 'public',
    entries: {
      read: new PostgresRlsPolicy({
        naming: { kind: 'exact', name: 'read policy' },
        namespaceId: 'public',
        tableName: 'widgets',
        operation: 'all',
        roles: ['writer', 'reader'],
        using: '"owner" = \'a\\b\'\nOR "id" = 1',
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
    using: {
      expression: 'sql`\n"owner" = \'a\\\\b\'\nOR "id" = 1\n`',
      span: expect.any(Object),
    },
    withCheck: { expression: 'sql`"active" = true`', span: expect.any(Object) },
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
