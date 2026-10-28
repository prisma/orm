import type { EntityCoordinate, StorageBase } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  changedElementCoordinates,
  coordinateKey,
  elementCoordinates,
  entityAt,
} from '../src/ir/storage';

function assertStoragePlaneCoordinates(coordinates: EntityCoordinate[]): void {
  expect(coordinates.length).toBeGreaterThan(0);
  for (const coordinate of coordinates) {
    expect(coordinate.plane).toBe('storage');
    expect(coordinate.namespaceId).toEqual(expect.any(String));
    expect(coordinate.namespaceId.length).toBeGreaterThan(0);
    expect(coordinate.entityKind).toEqual(expect.any(String));
    expect(coordinate.entityKind.length).toBeGreaterThan(0);
    expect(coordinate.entityName).toEqual(expect.any(String));
    expect(coordinate.entityName.length).toBeGreaterThan(0);
  }
}

describe('elementCoordinates', () => {
  it('walks namespace entries slot maps structurally', () => {
    const storage = {
      namespaces: {
        alpha: {
          id: 'alpha',
          kind: 'test-namespace',
          entries: {
            widgets: { a: {}, b: {} },
            gadgets: { x: {} },
            skippedNull: null,
            skippedScalar: 'ignored',
          },
        },
        beta: {
          id: 'beta',
          kind: 'test-namespace',
          entries: {
            table: { users: {}, posts: {}, comments: {} },
          },
        },
      },
    };

    const coordinates = [
      ...elementCoordinates(
        blindCast<Pick<StorageBase, 'namespaces'>, 'synthetic namespace walk fixture'>(storage),
      ),
    ];
    assertStoragePlaneCoordinates(coordinates);

    expect(coordinates).toEqual(
      expect.arrayContaining([
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'a' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'widgets', entityName: 'b' },
        { plane: 'storage', namespaceId: 'alpha', entityKind: 'gadgets', entityName: 'x' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'users' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'posts' },
        { plane: 'storage', namespaceId: 'beta', entityKind: 'table', entityName: 'comments' },
      ]),
    );
    expect(coordinates).toHaveLength(6);
    expect(coordinates.some((c) => c.entityKind === 'id')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedNull')).toBe(false);
    expect(coordinates.some((c) => c.entityKind === 'skippedScalar')).toBe(false);
  });
});

describe('coordinateKey', () => {
  it('produces the same key for the same coordinate', () => {
    const a = coordinateKey({ namespaceId: 'public', entityKind: 'table', entityName: 'users' });
    const b = coordinateKey({ namespaceId: 'public', entityKind: 'table', entityName: 'users' });
    expect(a).toBe(b);
  });

  it('does not collide when a delimiter-joined key would', () => {
    const a = coordinateKey({ namespaceId: 'a b', entityKind: 'c', entityName: 'd' });
    const b = coordinateKey({ namespaceId: 'a', entityKind: 'b c', entityName: 'd' });
    expect(a).not.toBe(b);
  });

  it('distinguishes coordinates that differ only in entityKind', () => {
    const table = coordinateKey({ namespaceId: 'public', entityKind: 'table', entityName: 'x' });
    const widget = coordinateKey({ namespaceId: 'public', entityKind: 'widget', entityName: 'x' });
    expect(table).not.toBe(widget);
  });
});

describe('entityAt', () => {
  const storage = blindCast<Pick<StorageBase, 'namespaces'>, 'synthetic storage fixture'>({
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: { name: 'users' }, posts: { name: 'posts' } } },
      },
      auth: {
        id: 'auth',
        entries: {
          table: { identities: { name: 'identities' } },
          valueSet: { Role: { name: 'Role' } },
        },
      },
    },
  });

  it('resolves a known coordinate', () => {
    const entity = entityAt(storage, {
      namespaceId: 'public',
      entityKind: 'table',
      entityName: 'users',
    });
    expect(entity).toEqual({ name: 'users' });
  });

  it('resolves across kinds', () => {
    const entity = entityAt(storage, {
      namespaceId: 'auth',
      entityKind: 'valueSet',
      entityName: 'Role',
    });
    expect(entity).toEqual({ name: 'Role' });
  });

  it('returns undefined for unknown namespace', () => {
    expect(
      entityAt(storage, { namespaceId: 'missing', entityKind: 'table', entityName: 'users' }),
    ).toBeUndefined();
  });

  it('returns undefined for unknown entityKind', () => {
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'collection', entityName: 'users' }),
    ).toBeUndefined();
  });

  it('returns undefined for unknown entityName', () => {
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'table', entityName: 'missing' }),
    ).toBeUndefined();
  });

  it('returns undefined for prototype keys like toString and constructor', () => {
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'table', entityName: 'toString' }),
    ).toBeUndefined();
    expect(
      entityAt(storage, { namespaceId: 'public', entityKind: 'table', entityName: 'constructor' }),
    ).toBeUndefined();
  });
});

describe('changedElementCoordinates', () => {
  function storageOf(namespaces: Record<string, unknown>): Pick<StorageBase, 'namespaces'> {
    return blindCast<Pick<StorageBase, 'namespaces'>, 'synthetic storage diff fixture'>({
      namespaces,
    });
  }

  it('lists added, removed and changed entities, sorted, and leaves out equal ones', () => {
    const from = storageOf({
      public: {
        entries: {
          table: { users: { columns: { id: 'int', name: 'text' } }, posts: { id: 1 } },
          valueSet: { Status: { values: ['open'] } },
        },
      },
    });
    const to = storageOf({
      public: {
        entries: {
          table: {
            users: { columns: { name: 'text', id: 'int', note: 'text' } },
            posts: { id: 1 },
          },
          valueSet: { Role: { values: ['admin'] } },
        },
      },
      audit: { entries: { table: { events: {} } } },
    });

    expect(changedElementCoordinates(from, to)).toEqual([
      { plane: 'storage', namespaceId: 'audit', entityKind: 'table', entityName: 'events' },
      { plane: 'storage', namespaceId: 'public', entityKind: 'table', entityName: 'users' },
      { plane: 'storage', namespaceId: 'public', entityKind: 'valueSet', entityName: 'Role' },
      { plane: 'storage', namespaceId: 'public', entityKind: 'valueSet', entityName: 'Status' },
    ]);
  });

  it('ignores key order inside an entity', () => {
    const from = storageOf({ public: { entries: { table: { users: { a: 1, b: 2 } } } } });
    const to = storageOf({ public: { entries: { table: { users: { b: 2, a: 1 } } } } });

    expect(changedElementCoordinates(from, to)).toEqual([]);
  });

  it('treats every entity as added when there is no earlier storage', () => {
    const to = storageOf({ public: { entries: { table: { users: {} } } } });

    expect(changedElementCoordinates(null, to)).toEqual([
      { plane: 'storage', namespaceId: 'public', entityKind: 'table', entityName: 'users' },
    ]);
  });
});
