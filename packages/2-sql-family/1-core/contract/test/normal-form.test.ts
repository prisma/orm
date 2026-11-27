import { canonicalizeContractToObject, computeStorageHash } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { normalizeSqlDomain, normalizeSqlStorage } from '../src/normal-form';

type Table = Record<string, unknown>;

const column = (extra: Record<string, unknown> = {}) => ({
  codecId: 'pg/text@1',
  dataType: 'pg/text',
  nullable: false,
  ...extra,
});

const reference = (columns: readonly string[] = ['id']) => ({
  namespaceId: 'public',
  tableName: 't',
  columns,
});

const foreignKey = (extra: Record<string, unknown> = {}) => ({
  source: reference(),
  target: reference(),
  ...extra,
});

const tableWith = (extra: Table = {}): Table => ({
  columns: { id: column() },
  uniques: [],
  indexes: [],
  foreignKeys: [],
  ...extra,
});

const storageWith = (
  entries: Record<string, unknown>,
  types?: Record<string, unknown>,
): Record<string, unknown> => ({
  namespaces: { public: { id: 'public', entries: { table: { t: tableWith() }, ...entries } } },
  ...(types === undefined ? {} : { types }),
});

const storageWithTable = (table: Table): Record<string, unknown> =>
  storageWith({ table: { t: table } });

const hashOf = (storage: Record<string, unknown>): string =>
  computeStorageHash({
    target: 'postgres',
    targetFamily: 'sql',
    storage,
    normalizeStorage: normalizeSqlStorage,
  });

const written = (storage: Record<string, unknown>): unknown => {
  const contract: Contract = blindCast({
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: 'test-profile',
    roots: {},
    domain: { namespaces: {} },
    storage,
    extensions: {},
    capabilities: {},
    meta: {},
  });
  return canonicalizeContractToObject(contract, {
    serializeContract: (c) =>
      blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
    normalizeStorage: normalizeSqlStorage,
  })['storage'];
};

const writtenTable = (storage: Record<string, unknown>): Table =>
  blindCast<{ namespaces: { public: { entries: { table: { t: Table } } } } }, 'test shape'>(
    written(storage),
  ).namespaces.public.entries.table.t;

describe('SQL storage values the family does not own', () => {
  const pairs: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>]> =
    [
      [
        'a column type parameter that is false',
        storageWithTable(
          tableWith({ columns: { id: column({ typeParams: { strict: false, length: 3 } }) } }),
        ),
        storageWithTable(tableWith({ columns: { id: column({ typeParams: { length: 3 } }) } })),
      ],
      [
        'column type parameters of false and of an empty list',
        storageWithTable(tableWith({ columns: { id: column({ typeParams: { strict: false } }) } })),
        storageWithTable(tableWith({ columns: { id: column({ typeParams: { tags: [] } }) } })),
      ],
      [
        'a storage type parameter that is false',
        storageWith(
          {},
          {
            T: {
              kind: 'codec-instance',
              codecId: 'c',
              dataType: 'd',
              typeParams: { strict: false, length: 3 },
            },
          },
        ),
        storageWith(
          {},
          { T: { kind: 'codec-instance', codecId: 'c', dataType: 'd', typeParams: { length: 3 } } },
        ),
      ],
      [
        'an index option that is false',
        storageWithTable(
          tableWith({
            indexes: [
              {
                name: 'i',
                columns: ['id'],
                unique: false,
                type: 'gin',
                options: { fastupdate: false, fillfactor: 70 },
              },
            ],
          }),
        ),
        storageWithTable(
          tableWith({
            indexes: [
              {
                name: 'i',
                columns: ['id'],
                unique: false,
                type: 'gin',
                options: { fillfactor: 70 },
              },
            ],
          }),
        ),
      ],
      [
        'a column type parameter that is an empty object',
        storageWithTable(tableWith({ columns: { id: column({ typeParams: { options: {} } }) } })),
        storageWithTable(tableWith({ columns: { id: column({ typeParams: { length: 3 } }) } })),
      ],
      [
        'foreign keys with the same columns and different actions',
        storageWithTable(tableWith({ foreignKeys: [foreignKey({ onDelete: 'cascade' })] })),
        storageWithTable(tableWith({ foreignKeys: [foreignKey()] })),
      ],
      [
        'a value set member that is an object holding false',
        storageWith({ valueSet: { V: { kind: 'valueSet', values: [{ a: false }] } } }),
        storageWith({ valueSet: { V: { kind: 'valueSet', values: [{}] } } }),
      ],
      [
        "a restrictive policy's permissive: false",
        storageWith({ policy: { p: { table: 't', using: 'true', permissive: false, roles: [] } } }),
        storageWith({ policy: { p: { table: 't', using: 'true' } } }),
      ],
      [
        "an empty map inside a pack's own entry",
        storageWith({ 'custom-block': { e: { values: {}, attributes: { a: false } } } }),
        storageWith({ 'custom-block': { e: { attributes: {} } } }),
      ],
    ];

  it.each(pairs)('gives contracts that differ in %s different hashes', (_, left, right) => {
    expect(hashOf(left)).not.toBe(hashOf(right));
  });

  it.each(pairs)('writes %s as given', (_, left) => {
    expect(written(left)).toEqual(left);
  });
});

describe('SQL storage defaults the family leaves out', () => {
  const pairs: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>]> =
    [
      [
        'a column many: false',
        storageWithTable(tableWith({ columns: { id: column({ many: false }) } })),
        storageWithTable(tableWith()),
      ],
      ['empty checks', storageWithTable(tableWith({ checks: [] })), storageWithTable(tableWith())],
      [
        "an index's empty columns and empty options",
        storageWithTable(
          tableWith({
            indexes: [
              { name: 'i', expression: 'lower(id)', unique: false, columns: [], options: {} },
            ],
          }),
        ),
        storageWithTable(
          tableWith({ indexes: [{ name: 'i', expression: 'lower(id)', unique: false }] }),
        ),
      ],
      [
        "a foreign key's index: false and noAction actions",
        storageWithTable(
          tableWith({
            foreignKeys: [
              {
                source: { namespaceId: 'public', tableName: 't', columns: ['id'] },
                target: { namespaceId: 'public', tableName: 't', columns: ['id'] },
                index: false,
                onDelete: 'noAction',
                onUpdate: 'noAction',
              },
            ],
          }),
        ),
        storageWithTable(
          tableWith({
            foreignKeys: [
              {
                source: { namespaceId: 'public', tableName: 't', columns: ['id'] },
                target: { namespaceId: 'public', tableName: 't', columns: ['id'] },
              },
            ],
          }),
        ),
      ],
      [
        "a storage type's empty typeParams",
        storageWith(
          {},
          { T: { kind: 'codec-instance', codecId: 'c', dataType: 'd', typeParams: {} } },
        ),
        storageWith({}, { T: { kind: 'codec-instance', codecId: 'c', dataType: 'd' } }),
      ],
      [
        'a value-object field many: false',
        storageWith({
          valueObject: {
            Address: {
              fields: {
                city: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'pg/text@1' },
                  many: false,
                },
              },
            },
          },
        }),
        storageWith({
          valueObject: {
            Address: {
              fields: { city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
            },
          },
        }),
      ],
      [
        "a foreign key's index: true from before foreign keys named their index",
        storageWithTable(tableWith({ foreignKeys: [foreignKey({ index: true })] })),
        storageWithTable(tableWith({ foreignKeys: [foreignKey()] })),
      ],
      [
        "a column's empty typeParams",
        storageWithTable(tableWith({ columns: { id: column({ typeParams: {} }) } })),
        storageWithTable(tableWith()),
      ],
      [
        "a value-object field's empty typeParams",
        storageWith({
          valueObject: {
            Address: {
              fields: {
                city: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'pg/text@1', typeParams: {} },
                },
              },
            },
          },
        }),
        storageWith({
          valueObject: {
            Address: {
              fields: { city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
            },
          },
        }),
      ],
      [
        'foreign keys in another order',
        storageWithTable(
          tableWith({
            foreignKeys: [
              foreignKey({ name: 'z_fkey' }),
              foreignKey({ source: reference(['b']) }),
              foreignKey({ name: 'a_fkey' }),
              foreignKey({ source: reference(['a']) }),
            ],
          }),
        ),
        storageWithTable(
          tableWith({
            foreignKeys: [
              foreignKey({ source: reference(['a']) }),
              foreignKey({ source: reference(['b']) }),
              foreignKey({ name: 'a_fkey' }),
              foreignKey({ name: 'z_fkey' }),
            ],
          }),
        ),
      ],
      [
        'unnamed uniques in another order',
        storageWithTable(tableWith({ uniques: [{ columns: ['b'] }, { columns: ['a'] }] })),
        storageWithTable(tableWith({ uniques: [{ columns: ['a'] }, { columns: ['b'] }] })),
      ],
      ['an empty entity-kind slot', storageWith({ policy: {} }), storageWith({})],
    ];

  it.each(pairs)('gives a contract with %s written and left out one hash', (_, left, right) => {
    expect(hashOf(left)).toBe(hashOf(right));
  });

  it.each(pairs)('writes the same file whether %s is written or left out', (_, left, right) => {
    expect(written(left)).toEqual(written(right));
  });

  it('keeps the required empty table lists, an empty table slot and index unique: false', () => {
    const storage = storageWith({
      table: { t: tableWith({ indexes: [{ name: 'i', columns: ['id'], unique: false }] }) },
    });
    expect(writtenTable(storage)).toEqual({
      columns: { id: column() },
      uniques: [],
      indexes: [{ name: 'i', columns: ['id'], unique: false }],
      foreignKeys: [],
    });
    expect(written(storageWith({ table: {} }))).toEqual(storageWith({ table: {} }));
  });

  it('keeps a literal column default of false, an empty object and an empty list', () => {
    const columns = {
      flag: column({ default: { kind: 'literal', value: false } }),
      obj: column({ default: { kind: 'literal', value: {} } }),
      arr: column({ default: { kind: 'literal', value: [] } }),
    };
    expect(writtenTable(storageWithTable(tableWith({ columns })))['columns']).toEqual(columns);
  });
});

describe('normalizeSqlStorage ordering', () => {
  it('orders foreign keys by name, and those without a name by their content', () => {
    const table = writtenTable(
      storageWithTable(
        tableWith({
          foreignKeys: [
            foreignKey({ name: 'z_fkey' }),
            foreignKey({ source: reference(['b']) }),
            foreignKey({ name: 'a_fkey' }),
            foreignKey({ source: reference(['a']) }),
          ],
        }),
      ),
    );
    expect(table['foreignKeys']).toEqual([
      foreignKey({ source: reference(['a']) }),
      foreignKey({ source: reference(['b']) }),
      foreignKey({ name: 'a_fkey' }),
      foreignKey({ name: 'z_fkey' }),
    ]);
  });

  it('orders checks, indexes, and uniques by physical name', () => {
    const table = writtenTable(
      storageWithTable(
        tableWith({
          checks: [
            { name: 'z_check', expression: 'true' },
            { name: 'a_check', expression: 'true' },
          ],
          indexes: [
            { name: 'z_idx', columns: ['id'], unique: false },
            { name: 'a_idx', columns: ['id'], unique: false },
          ],
          uniques: [
            { name: 'z_key', columns: ['id'] },
            { name: 'a_key', columns: ['id'] },
          ],
        }),
      ),
    );
    const names = (key: string) =>
      blindCast<ReadonlyArray<{ name: string }>, 'test shape'>(table[key]).map((e) => e.name);
    expect({
      checks: names('checks'),
      indexes: names('indexes'),
      uniques: names('uniques'),
    }).toEqual({
      checks: ['a_check', 'z_check'],
      indexes: ['a_idx', 'z_idx'],
      uniques: ['a_key', 'z_key'],
    });
  });
});

describe('normalizeSqlDomain', () => {
  it("leaves out a model field's many: false and keeps everything else", () => {
    const domain = {
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {
                title: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'text', typeParams: { strict: false } },
                  many: false,
                },
                tags: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'text' },
                  many: { elementNullable: false },
                },
              },
              relations: {},
              storage: { table: 'task', namespaceId: 'app', fields: {} },
            },
          },
        },
      },
    };
    expect(normalizeSqlDomain(domain)).toEqual({
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {
                title: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'text', typeParams: { strict: false } },
                },
                tags: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'text' },
                  many: { elementNullable: false },
                },
              },
              relations: {},
              storage: { table: 'task', namespaceId: 'app', fields: {} },
            },
          },
        },
      },
    });
  });
});
