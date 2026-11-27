import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { validateSqlContractFully } from '../src/validators';

const ns = UNBOUND_NAMESPACE_ID;
const text = { kind: 'scalar', codecId: 'pg/text@1' };

function contractJson(): Record<string, unknown> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: 'test',
    roots: { user: { namespace: ns, model: 'User' } },
    domain: {
      namespaces: {
        [ns]: {
          enum: { Role: { codecId: 'pg/text@1', members: [{ name: 'admin', value: 'admin' }] } },
          models: {
            User: {
              storage: {
                table: 'user',
                namespaceId: ns,
                fields: { id: { column: 'id' }, role: { column: 'role' } },
              },
              fields: {
                id: { type: text, nullable: false },
                role: {
                  type: text,
                  nullable: false,
                  valueSet: {
                    plane: 'domain',
                    namespaceId: ns,
                    entityKind: 'enum',
                    entityName: 'Role',
                  },
                },
              },
              relations: {},
              discriminator: { field: 'role' },
              variants: { admin: { namespace: ns, model: 'Admin' } },
            },
            Admin: {
              storage: { table: 'user', namespaceId: ns, fields: {} },
              fields: {},
              relations: {},
              base: { namespace: ns, model: 'User' },
            },
          },
        },
      },
    },
    storage: {
      storageHash: 'test',
      types: {
        Name: { kind: 'codec-instance', codecId: 'pg/text@1', dataType: 'pg/text' },
      },
      namespaces: {
        [ns]: {
          id: ns,
          entries: {
            table: {
              user: {
                columns: {
                  id: {
                    dataType: 'pg/text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    default: { kind: 'function', expression: 'gen_random_uuid()' },
                  },
                  role: {
                    dataType: 'pg/text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    default: { kind: 'literal', value: 'admin' },
                    valueSet: {
                      plane: 'storage',
                      namespaceId: ns,
                      entityKind: 'valueSet',
                      entityName: 'Role',
                    },
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [{ columns: ['role'] }],
                indexes: [{ name: 'user_role_idx', columns: ['role'], unique: false }],
                foreignKeys: [
                  {
                    source: { namespaceId: ns, tableName: 'user', columns: ['role'] },
                    target: { namespaceId: ns, tableName: 'user', columns: ['id'] },
                  },
                ],
              },
            },
            valueSet: { Role: { kind: 'valueSet', values: ['admin'] } },
          },
        },
      },
    },
  };
}

function withUnknownKeyAt(path: readonly (string | number)[]): Record<string, unknown> {
  const contract = contractJson();
  let place: unknown = contract;
  for (const step of path) {
    place = (place as Record<string | number, unknown>)[step];
  }
  (place as Record<string, unknown>)['unexpected'] = true;
  return contract;
}

function pathText(path: readonly (string | number)[]): string {
  return path
    .map((step, i) => (typeof step === 'number' ? `[${step}]` : i === 0 ? step : `.${step}`))
    .join('');
}

const table = ['storage', 'namespaces', ns, 'entries', 'table', 'user'] as const;
const user = ['domain', 'namespaces', ns, 'models', 'User'] as const;

const places: readonly (readonly (string | number)[])[] = [
  ['domain'],
  ['domain', 'namespaces', ns],
  [...user],
  [...user, 'storage'],
  [...user, 'storage', 'fields', 'id'],
  [...user, 'discriminator'],
  [...user, 'fields', 'role', 'valueSet'],
  ['domain', 'namespaces', ns, 'enum', 'Role', 'members', 0],
  ['storage', 'types', 'Name'],
  [...table, 'columns', 'id', 'default'],
  [...table, 'columns', 'role', 'default'],
  [...table, 'columns', 'role', 'valueSet'],
  [...table, 'primaryKey'],
  [...table, 'uniques', 0],
  [...table, 'indexes', 0],
  [...table, 'foreignKeys', 0],
  ['storage', 'namespaces', ns, 'entries', 'valueSet', 'Role'],
];

describe('a contract with a key its format does not define', () => {
  it('is accepted without the key', () => {
    expect(() => validateSqlContractFully(contractJson())).not.toThrow();
  });

  it.each(places.map((path) => ({ place: path.join('.'), path })))(
    'is refused at $place, naming the key',
    ({ path }) => {
      expect(() => validateSqlContractFully(withUnknownKeyAt(path))).toThrow(
        `${pathText([...path, 'unexpected'])} must be removed`,
      );
    },
  );
});
