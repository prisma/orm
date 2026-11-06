import { coreHash } from '@internal/contract/types';
import { elementCoordinates, entityAt } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { SqlStorage } from '../src/ir/sql-storage';
import { createTestSqlNamespace } from './test-support';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with SqlStorage', () => {
  it('walks SQL namespace table entries', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('element-coordinates-sql'),
      namespaces: {
        app: createTestSqlNamespace({ id: 'app', entries: { table: { users: emptyTableInput } } }),
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'app',
      entityKind: 'table',
      entityName: 'users',
    });
  });
});

describe('coordinate-resolution acceptance — every elementCoordinates tuple resolves', () => {
  it('every coordinate from a sql storage resolves through entityAt', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('coord-resolution-sql'),
      namespaces: {
        app: createTestSqlNamespace({
          id: 'app',
          entries: {
            table: { users: emptyTableInput, posts: emptyTableInput },
            valueSet: { status: { kind: 'value-set', values: ['active', 'inactive'] } },
          },
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
