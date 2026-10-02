import { describe, expect, it } from 'vitest';
import { printingWidget } from './refusal-support';

const WHY =
  'A sql literal is canonicalized when it is read: indentation shared by every line, a blank first or last line, a carriage return and a whitespace-only line are removed, so this text would read back as different SQL.';
const FIX =
  "Write the SQL in that canonical form in the contract's source, or keep authoring this contract in its current source.";

describe('SQL a sql literal cannot write back unchanged', () => {
  it('refuses an index whose where clause ends in a newline', () => {
    const print = printingWidget({
      table: {
        indexes: [{ name: 'widget_id_idx', unique: false, columns: ['id'], where: 'id > 0\n' }],
      },
    });

    expect(print).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: index "widget_id_idx" on "public"."Widget" holds SQL that a sql literal cannot write back unchanged, so it cannot be written in Prisma 8 PSL.',
        why: WHY,
        fix: FIX,
        meta: { namespaceId: 'public', table: 'Widget', name: 'widget_id_idx' },
      }),
    );
  });

  it('refuses a check whose expression ends in a newline', () => {
    const print = printingWidget({
      table: { checks: [{ name: 'widget_id_positive', expression: 'id > 0\n' }] },
    });

    expect(print).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: check "widget_id_positive" on "public"."Widget" holds SQL that a sql literal cannot write back unchanged, so it cannot be written in Prisma 8 PSL.',
        why: WHY,
        fix: FIX,
        meta: { namespaceId: 'public', table: 'Widget', name: 'widget_id_positive' },
      }),
    );
  });

  it('refuses a policy whose using predicate ends in a newline', () => {
    const print = printingWidget({
      entries: {
        rls: { Widget: { kind: 'rls', namespaceId: 'public', tableName: 'Widget' } },
        policy: {
          widget_read: {
            kind: 'policy',
            name: 'widget_read',
            tableName: 'Widget',
            namespaceId: 'public',
            operation: 'select',
            roles: ['app_user'],
            using: 'true\n',
            permissive: true,
          },
        },
      },
      storageNamespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: {
            table: {},
            role: {
              app_user: {
                kind: 'role',
                name: 'app_user',
                namespaceId: '__unbound__',
                control: 'external',
              },
            },
          },
        },
      },
    });

    expect(print).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: policy "widget_read" on "public"."Widget" holds SQL that a sql literal cannot write back unchanged, so it cannot be written in Prisma 8 PSL.',
        why: WHY,
        fix: FIX,
        meta: { namespaceId: 'public', table: 'Widget', policy: 'widget_read' },
      }),
    );
  });
});
