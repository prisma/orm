import { soleDomainNamespaceId } from '@internal/contract/types';
import { LockingClause } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';
import { baseContract, createCollectionFor } from './collection-fixtures';
import { createMockRuntime, getTestContext, withCapabilities } from './helpers';

const allFlags = baseContract.capabilities;

function postsWith<Caps extends Record<string, Record<string, boolean>>>(capabilities: Caps) {
  const contract = withCapabilities(baseContract, capabilities);
  return new Collection(
    { runtime: createMockRuntime(), context: { ...getTestContext(), contract } },
    'Post',
    {
      namespaceId: soleDomainNamespaceId(contract.domain),
    },
  );
}

const capabilityMissing = (method: string, capability: string) =>
  expect.objectContaining({
    name: 'StructuredError',
    code: 'ORM.CAPABILITY_MISSING',
    message: `${method}() requires capability ${capability}`,
    meta: { capability, method },
  });

describe('row-locking methods', () => {
  it.each(['forUpdate', 'forNoKeyUpdate', 'forShare', 'forKeyShare'] as const)(
    '%s appends a clause locking the model table',
    (method) => {
      const { collection } = createCollectionFor('Post');

      expect(collection[method]().state.locking).toEqual([
        LockingClause.of(method, { of: ['posts'] }),
      ]);
    },
  );

  it.each(['forUpdate', 'forNoKeyUpdate', 'forShare', 'forKeyShare'] as const)(
    '%s returns an instance of the receiver class',
    (method) => {
      const { db } = createChainingOrm();

      expect(db.Post[method]()).toBeInstanceOf(PostCollection);
    },
  );

  it('nowait and skipLocked set the wait policy', () => {
    const { collection } = createCollectionFor('Post');

    expect(collection.forUpdate({ nowait: true }).state.locking).toEqual([
      LockingClause.of('forUpdate', { of: ['posts'], waitPolicy: 'nowait' }),
    ]);
    expect(collection.forShare({ skipLocked: true }).state.locking).toEqual([
      LockingClause.of('forShare', { of: ['posts'], waitPolicy: 'skipLocked' }),
    ]);
  });

  it('two calls append two clauses in order', () => {
    const { collection } = createCollectionFor('Post');

    expect(collection.forUpdate().forKeyShare({ skipLocked: true }).state.locking).toEqual([
      LockingClause.of('forUpdate', { of: ['posts'] }),
      LockingClause.of('forKeyShare', { of: ['posts'], waitPolicy: 'skipLocked' }),
    ]);
  });

  it('the lock survives later where, orderBy and limit calls', () => {
    const { collection } = createCollectionFor('Post');
    const locked = collection
      .forUpdate()
      .where((post) => post.views.gt(1))
      .orderBy((post) => post.id.asc())
      .limit(1);

    expect(locked.state.locking).toEqual([LockingClause.of('forUpdate', { of: ['posts'] })]);
  });

  it('nowait with skipLocked throws ORM.ARGUMENT_INVALID', () => {
    const { collection } = createCollectionFor('Post');

    // @ts-expect-error nowait and skipLocked exclude each other
    expect(() => collection.forUpdate({ nowait: true, skipLocked: true })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'forUpdate() takes nowait or skipLocked, not both',
        meta: { method: 'forUpdate' },
      }),
    );
  });

  describe('capabilities', () => {
    it.each([
      {
        method: 'forUpdate',
        capability: 'sql.forUpdate',
        call: () => {
          const posts = postsWith({ ...allFlags, sql: { ...allFlags.sql, forUpdate: false } });
          // @ts-expect-error forUpdate needs sql.forUpdate
          return posts.forUpdate();
        },
      },
      {
        method: 'forShare',
        capability: 'sql.forShare',
        call: () => {
          const posts = postsWith({ ...allFlags, sql: { ...allFlags.sql, forShare: false } });
          // @ts-expect-error forShare needs sql.forShare
          return posts.forShare();
        },
      },
      {
        method: 'forNoKeyUpdate',
        capability: 'postgres.forNoKeyUpdate',
        call: () => {
          const posts = postsWith({
            ...allFlags,
            postgres: { ...allFlags.postgres, forNoKeyUpdate: false },
          });
          // @ts-expect-error forNoKeyUpdate needs postgres.forNoKeyUpdate
          return posts.forNoKeyUpdate();
        },
      },
      {
        method: 'forKeyShare',
        capability: 'postgres.forKeyShare',
        call: () => {
          const posts = postsWith({
            ...allFlags,
            postgres: { ...allFlags.postgres, forKeyShare: false },
          });
          // @ts-expect-error forKeyShare needs postgres.forKeyShare
          return posts.forKeyShare();
        },
      },
    ])('$method throws without $capability', ({ method, capability, call }) => {
      expect(call).toThrow(capabilityMissing(method, capability));
    });

    it.each(['forUpdate', 'forNoKeyUpdate', 'forShare', 'forKeyShare'] as const)(
      '%s throws without sql.lockOf, because the ORM always renders OF',
      (method) => {
        const posts = postsWith({ ...allFlags, sql: { ...allFlags.sql, lockOf: false } });

        // @ts-expect-error every locking method needs sql.lockOf
        expect(() => posts[method]()).toThrow(capabilityMissing(method, 'sql.lockOf'));
      },
    );

    it('checks the flag in its own group', () => {
      const collection = postsWith({
        ...allFlags,
        sql: { ...allFlags.sql, forUpdate: false },
        postgres: { ...allFlags.postgres, forUpdate: true },
      });

      // @ts-expect-error forUpdate is gated out without sql.forUpdate
      expect(() => collection.forUpdate()).toThrow(capabilityMissing('forUpdate', 'sql.forUpdate'));
    });

    it('nowait throws without sql.lockNowait', () => {
      const collection = postsWith({ ...allFlags, sql: { ...allFlags.sql, lockNowait: false } });

      expect(collection.forUpdate().state.locking).toEqual([
        LockingClause.of('forUpdate', { of: ['posts'] }),
      ]);
      // @ts-expect-error nowait needs sql.lockNowait
      expect(() => collection.forUpdate({ nowait: true })).toThrow(
        capabilityMissing('forUpdate', 'sql.lockNowait'),
      );
    });

    it('skipLocked throws without sql.lockSkipLocked', () => {
      const collection = postsWith({
        ...allFlags,
        sql: { ...allFlags.sql, lockSkipLocked: false },
      });

      expect(collection.forUpdate().state.locking).toEqual([
        LockingClause.of('forUpdate', { of: ['posts'] }),
      ]);
      // @ts-expect-error skipLocked needs sql.lockSkipLocked
      expect(() => collection.forUpdate({ skipLocked: true })).toThrow(
        capabilityMissing('forUpdate', 'sql.lockSkipLocked'),
      );
    });
  });
});
