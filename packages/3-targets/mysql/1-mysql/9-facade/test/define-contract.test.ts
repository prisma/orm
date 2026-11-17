import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, enumType, member } from '../src/exports/contract-builder';

describe('defineContract for MySQL', () => {
  it('builds a contract for target mysql whose enum column lists its members', () => {
    const Role = enumType(
      'Role',
      { codecId: 'mysql/enum@1' },
      member('USER', 'USER'),
      member('ADMIN', 'ADMIN'),
    );
    const contract = defineContract({ enums: { Role } }, ({ field: f, model: m }) => ({
      models: {
        User: m('User', {
          fields: {
            id: f.column({ codecId: 'mysql/int@1' }).id(),
            role: f.namedType(Role),
          },
        }),
      },
    }));
    const table = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['User'];
    expect({
      target: contract.target,
      kind: contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.kind,
      role: (table?.columns['role'] as { readonly typeParams?: unknown } | undefined)?.typeParams,
    }).toEqual({ target: 'mysql', kind: 'mysql-namespace', role: { values: ['USER', 'ADMIN'] } });
  });

  it('stores a type.sql.Ulid() column as the type.sql.Char(26) column', () => {
    const columnOf = (written: 'alias' | 'char') =>
      defineContract({}, ({ field: f, model: m, type, gen }) => ({
        models: {
          User: m('User', {
            fields: {
              id: f
                .column(written === 'alias' ? type.sql.Ulid() : type.sql.Char(26))
                .id()
                .onCreate(gen.ulid()),
            },
          }),
        },
      })).storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.table?.['User']?.columns['id'];
    const alias = columnOf('alias');
    expect(alias).toMatchObject({ codecId: 'sql/char@1' });
    expect(alias).toEqual(columnOf('char'));
  });
});
