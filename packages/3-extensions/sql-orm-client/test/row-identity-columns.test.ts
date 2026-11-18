import { describe, expect, it } from 'vitest';
import { resolveRowIdentityColumns } from '../src/collection-contract';

type ContractArg = Parameters<typeof resolveRowIdentityColumns>[0];

function contractWithTable(table: {
  readonly primaryKey?: { readonly columns: readonly string[] };
  readonly uniques: ReadonlyArray<{ readonly columns: readonly string[] }>;
  readonly nullable: readonly string[];
}): ContractArg {
  const columns = Object.fromEntries(
    ['id', 'email', 'handle', 'tenant'].map((name) => [
      name,
      { codecId: 'pg/text@1', nativeType: 'text', nullable: table.nullable.includes(name) },
    ]),
  );
  return {
    storage: {
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          entries: {
            table: {
              t: { columns, primaryKey: table.primaryKey, uniques: table.uniques },
            },
          },
        },
      },
    },
  } as unknown as ContractArg;
}

describe('resolveRowIdentityColumns() with nullable columns', () => {
  it('skips a unique key with a nullable column', () => {
    const contract = contractWithTable({
      uniques: [{ columns: ['email'] }, { columns: ['handle'] }],
      nullable: ['email'],
    });
    expect(resolveRowIdentityColumns(contract, '__unbound__', 't')).toEqual(['handle']);
  });

  it('skips a composite unique key when any of its columns is nullable', () => {
    const contract = contractWithTable({
      uniques: [{ columns: ['tenant', 'email'] }],
      nullable: ['email'],
    });
    expect(resolveRowIdentityColumns(contract, '__unbound__', 't')).toEqual([]);
  });

  it('keeps the primary key', () => {
    const contract = contractWithTable({
      primaryKey: { columns: ['id'] },
      uniques: [],
      nullable: ['email'],
    });
    expect(resolveRowIdentityColumns(contract, '__unbound__', 't')).toEqual(['id']);
  });
});
