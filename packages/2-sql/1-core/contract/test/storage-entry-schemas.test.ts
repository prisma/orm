import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import { createSqlStorageSchema } from '../src/validators';

describe('StorageColumnSchema — narrow validation', () => {
  const storageSchema = createSqlStorageSchema(composeSqlEntityKinds());

  function makeRawStorage(columnExtra: Record<string, unknown>) {
    return {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  role: {
                    nativeType: 'text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    ...columnExtra,
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
    };
  }

  it('accepts a column with only typeParams set', () => {
    const result = storageSchema(makeRawStorage({ typeParams: { length: 255 } }));
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts a column with only typeRef set', () => {
    const result = storageSchema(makeRawStorage({ typeRef: 'MyType' }));
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a column with both typeParams and typeRef set', () => {
    const result = storageSchema(
      makeRawStorage({ typeParams: { length: 255 }, typeRef: 'MyType' }),
    );
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects a column with an empty noCheck array', () => {
    const result = storageSchema(makeRawStorage({ noCheck: [] }));
    expect(result).toBeInstanceOf(type.errors);
  });

  it('accepts a column with a single-element noCheck array', () => {
    const result = storageSchema(makeRawStorage({ noCheck: ['membership'] }));
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts a column with sorted, unique noCheck kinds', () => {
    const result = storageSchema(makeRawStorage({ noCheck: ['elementNotNull', 'membership'] }));
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a column with unsorted noCheck kinds', () => {
    const result = storageSchema(makeRawStorage({ noCheck: ['membership', 'elementNotNull'] }));
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects a column with duplicate noCheck kinds', () => {
    const result = storageSchema(makeRawStorage({ noCheck: ['membership', 'membership'] }));
    expect(result).toBeInstanceOf(type.errors);
  });
});
