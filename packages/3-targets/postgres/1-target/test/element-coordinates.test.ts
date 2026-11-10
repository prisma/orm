import { coreHash } from '@internal/contract/types';
import {
  elementCoordinates,
  entityAt,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresSchema, PostgresUnboundSchema } from '../src/core/postgres-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('elementCoordinates with PostgresSchema', () => {
  it('walks Postgres-promoted namespace (kind === schema)', () => {
    const schema = new PostgresSchema({
      id: 'public',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.kind).toBe('schema');

    const storage = new SqlStorage({
      storageHash: coreHash('element-coordinates-test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
        public: schema,
      },
    });

    const coordinates = [...elementCoordinates(storage)];
    expect(coordinates).toContainEqual({
      plane: 'storage',
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'users',
    });
  });
});

describe('coordinate-resolution acceptance — every elementCoordinates tuple resolves', () => {
  it('every coordinate from a postgres storage resolves through entityAt', () => {
    const storage = new SqlStorage({
      storageHash: coreHash('coord-resolution-postgres'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: { users: emptyTableInput, posts: emptyTableInput },
            type: { role: { name: 'Role', values: ['admin', 'member'] } },
            valueSet: { status: { kind: 'valueSet', values: ['active', 'inactive'] } },
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
