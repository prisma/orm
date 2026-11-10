import { coreHash } from '@internal/contract/types';
import {
  elementCoordinates,
  entityAt,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { SqliteDatabase, SqliteUnboundDatabase } from '../src/core/sqlite-unbound-database';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with SqliteDatabase', () => {
  it('walks SQLite namespace tables', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('element-coordinates-sqlite'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: SqliteUnboundDatabase.instance,
        main: new SqliteDatabase({ id: 'main', entries: { table: { users: emptyTableInput } } }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'main',
      entityKind: 'table',
      entityName: 'users',
    });
  });
});

describe('coordinate-resolution acceptance — every elementCoordinates tuple resolves', () => {
  it('every coordinate from a sqlite storage resolves through entityAt', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('coord-resolution-sqlite'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: SqliteUnboundDatabase.instance,
        main: new SqliteDatabase({
          id: 'main',
          entries: { table: { users: emptyTableInput, posts: emptyTableInput } },
        }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates.length).toBeGreaterThan(0);

    for (const coordinate of coordinates) {
      const entity = entityAt(storage, coordinate);
      expect(entity, `entityAt did not resolve ${JSON.stringify(coordinate)}`).toBeDefined();
    }
  });
});
