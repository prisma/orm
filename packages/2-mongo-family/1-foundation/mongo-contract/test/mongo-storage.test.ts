import { coreHash } from '@internal/contract/types';
import { freezeNode, NamespaceBase, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoIndex } from '../src/ir/mongo-index';
import { MongoStorage } from '../src/ir/mongo-storage';
import { MongoUnboundNamespace } from '../src/ir/mongo-unbound-namespace';
import { MongoValueSet } from '../src/ir/mongo-value-set';

const hash = coreHash('h_0');

class TestNamespace extends NamespaceBase {
  readonly kind = 'test-namespace' as const;
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
    collection: Object.freeze({}),
  });

  constructor(id: string) {
    super();
    this.id = id;
    freezeNode(this);
  }
}

describe('MongoStorage', () => {
  const defaultNamespace = new TestNamespace('default');

  it('exposes storageHash and namespaces as enumerable fields', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { default: defaultNamespace },
    });
    expect(Object.keys(storage)).toEqual(expect.arrayContaining(['storageHash', 'namespaces']));
  });

  it('accepts built namespace instances with collections', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: {
        default: buildMongoNamespace({
          id: 'default',
          entries: {
            collection: {
              events: new MongoCollection({
                indexes: [new MongoIndex({ name: 'ts_1', keys: [{ field: 'ts', direction: 1 }] })],
              }),
            },
          },
        }),
      },
    });
    expect(storage.namespaces['default']!.entries['collection']?.['events']).toBeInstanceOf(
      MongoCollection,
    );
  });

  it('preserves namespace instances passed in (target supplies)', () => {
    const auth = new TestNamespace('auth');
    const namespaces = { default: defaultNamespace, auth };
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces,
    });
    expect(storage.namespaces['default']).toBe(defaultNamespace);
    expect(storage.namespaces['auth']).toBe(auth);
  });

  it('is frozen after construction', () => {
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { default: defaultNamespace },
    });
    expect(Object.isFrozen(storage)).toBe(true);
  });

  it('constructs from the unbound namespace singleton alone', () => {
    // `namespaces` is a required field on `MongoStorageInput`, so the
    // empty/omitted case is a type error rather than a runtime throw —
    // this exercises the happy path of an unbound-only storage.
    const storage = new MongoStorage({
      storageHash: hash,
      namespaces: { [UNBOUND_NAMESPACE_ID]: MongoUnboundNamespace.instance },
    });
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]).toBe(MongoUnboundNamespace.instance);
  });

  it('buildMongoNamespace carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const ns = buildMongoNamespace({
      id: 'default',
      entries: { collection: {}, bogus: bogusMap } as never,
    });
    expect(ns.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(ns.entries['bogus'])).toBe(true);
  });

  it('buildMongoNamespace unknown kind survives JSON.stringify round-trip', () => {
    const ns = buildMongoNamespace({
      id: 'default',
      entries: { collection: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(ns)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });

  it('buildMongoNamespace with unbound id and only an unknown kind does not return the unbound singleton', () => {
    const ns = buildMongoNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { bogus: { item: {} } } as never,
    });
    expect(ns.entries['bogus']).toBeDefined();
    expect(ns).not.toBe(MongoUnboundNamespace.instance);
  });

  it('buildMongoNamespace hydrates a valueSet slot into MongoValueSet instances', () => {
    const ns = buildMongoNamespace({
      id: 'default',
      entries: {
        collection: {},
        valueSet: { Role: { kind: 'valueSet', values: ['admin', 'author', 'reader'] } },
      },
    });
    const roleVs = ns.entries['valueSet']?.['Role'];
    expect(roleVs).toBeInstanceOf(MongoValueSet);
    expect((roleVs as MongoValueSet).values).toEqual(['admin', 'author', 'reader']);
  });

  it('buildMongoNamespace value set survives JSON.stringify round-trip and re-hydrates equal', () => {
    const ns = buildMongoNamespace({
      id: 'default',
      entries: {
        collection: {},
        valueSet: { Role: { kind: 'valueSet', values: ['admin', 'reader'] } },
      },
    });
    const json = JSON.parse(JSON.stringify(ns)) as { entries: Record<string, unknown> };
    expect(json.entries['valueSet']).toEqual({
      Role: { kind: 'valueSet', values: ['admin', 'reader'] },
    });
    const rehydrated = buildMongoNamespace({
      id: 'default',
      entries: json.entries as never,
    });
    expect(rehydrated.entries['valueSet']?.['Role']).toBeInstanceOf(MongoValueSet);
    expect((rehydrated.entries['valueSet']!['Role'] as MongoValueSet).values).toEqual([
      'admin',
      'reader',
    ]);
  });

  it('buildMongoNamespace with unbound id and only a valueSet slot does not return the unbound singleton', () => {
    const ns = buildMongoNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { valueSet: { Role: { kind: 'valueSet', values: ['admin'] } } },
    });
    expect(ns.entries['valueSet']?.['Role']).toBeInstanceOf(MongoValueSet);
    expect(ns).not.toBe(MongoUnboundNamespace.instance);
  });
});
