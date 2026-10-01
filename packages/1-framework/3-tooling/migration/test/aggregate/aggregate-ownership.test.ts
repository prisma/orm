import type { Contract } from '@internal/contract/types';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createContractSpaceAggregate } from '../../src/aggregate/aggregate';
import type { AggregateContractSpace, ContractSpaceAggregate } from '../../src/aggregate/types';
import { makeAggregateContractSpace } from '../fixtures';

function makeSpace(
  spaceId: string,
  namespaces: Record<string, Record<string, Record<string, unknown>>>,
): AggregateContractSpace {
  return makeAggregateContractSpace({
    spaceId,
    contract: createSqlContract({
      target: 'postgres',
      storage: {
        namespaces: Object.fromEntries(
          Object.entries(namespaces).map(([id, entries]) => [id, { id, entries }]),
        ),
      },
    }) as Contract,
  });
}

function makeAggregate(
  app: AggregateContractSpace,
  extensions: AggregateContractSpace[],
): ContractSpaceAggregate {
  return createContractSpaceAggregate({
    targetId: 'postgres',
    app,
    extensions,
    checkIntegrity: () => [],
  });
}

const inPublic = (entityName: string, entityKind = 'table') => ({
  namespaceId: 'public',
  entityKind,
  entityName,
});

// The migration planner consults the aggregate as a `SchemaOwnership` oracle:
// per live extra node it asks `declaresEntity` whether any space owns it, so a
// sibling-owned table is never dropped. These pin the aggregate side of that
// contract directly (the planner side is pinned by the target sibling-scoping
// suites driving `plan()` with the aggregate as the oracle).
describe('ContractSpaceAggregate ownership queries', () => {
  it('declaresEntity is true for a coordinate any space declares, false otherwise', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect(aggregate.declaresEntity(inPublic('app_user'))).toBe(true);
    expect(aggregate.declaresEntity(inPublic('cipher_state'))).toBe(true);
    expect(aggregate.declaresEntity(inPublic('orphan_table'))).toBe(false);
  });

  it('declaresEntity answers across every space, not just the app', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const audit = makeSpace('audit', { public: { table: { audit_log: {} } } });
    const aggregate = makeAggregate(app, [cipher, audit]);

    expect(aggregate.declaresEntity(inPublic('audit_log'))).toBe(true);
    expect(aggregate.declaresEntity(inPublic('nothing'))).toBe(false);
  });

  it('a single-space aggregate only owns its own entities (the aggregate-of-one case)', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const aggregate = makeAggregate(app, []);

    expect(aggregate.declaresEntity(inPublic('app_user'))).toBe(true);
    expect(aggregate.declaresEntity(inPublic('cipher_state'))).toBe(false);
  });

  it('ownerOf names the space that declares the coordinate, and nothing for an undeclared one', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect(aggregate.ownerOf(inPublic('app_user'))).toBe('app');
    expect(aggregate.ownerOf(inPublic('cipher_state'))).toBe('cipherstash');
    expect(aggregate.ownerOf(inPublic('orphan_table'))).toBeUndefined();
  });

  it('declaringSpaces returns every space declaring the coordinate', () => {
    const app = makeSpace('app', { public: { table: { app_user: {} } } });
    const cipher = makeSpace('cipherstash', { public: { table: { cipher_state: {} } } });
    const aggregate = makeAggregate(app, [cipher]);

    expect(aggregate.declaringSpaces(inPublic('app_user'))).toEqual(['app']);
    expect(aggregate.declaringSpaces(inPublic('cipher_state'))).toEqual(['cipherstash']);
    expect(aggregate.declaringSpaces(inPublic('orphan_table'))).toEqual([]);
  });

  it('does not conflate the same bare entity name declared in a different namespace', () => {
    // `app` declares `users` in `tenant_a`; a live `users` table sitting in
    // `tenant_b` is a genuine orphan, not something `app` owns — the oracle
    // must distinguish namespace, not match on the bare name alone.
    const app = makeSpace('app', { tenant_a: { table: { users: {} } } });
    const aggregate = makeAggregate(app, []);

    expect(
      aggregate.declaresEntity({
        namespaceId: 'tenant_a',
        entityKind: 'table',
        entityName: 'users',
      }),
    ).toBe(true);
    expect(
      aggregate.declaresEntity({
        namespaceId: 'tenant_b',
        entityKind: 'table',
        entityName: 'users',
      }),
    ).toBe(false);
    expect(
      aggregate.declaringSpaces({
        namespaceId: 'tenant_b',
        entityKind: 'table',
        entityName: 'users',
      }),
    ).toEqual([]);
  });

  it('does not conflate the same bare entity name declared as a different entity kind', () => {
    // `app` declares a TABLE named `app_user` in `public`, plus a value set
    // (an enum-like entity) ALSO named `widget` in the same namespace as a
    // live table named `widget`. A live `widget` TABLE the differ reports as
    // an extra is a genuine orphan — nobody declares a `widget` TABLE — even
    // though `app` separately declares a `widget` value set. The oracle must
    // distinguish entity kind, not just namespace and name.
    const app = makeSpace('app', {
      public: { table: { app_user: {} }, valueSet: { widget: {} } },
    });
    const aggregate = makeAggregate(app, []);

    expect(aggregate.declaresEntity(inPublic('widget', 'table'))).toBe(false);
    expect(aggregate.declaresEntity(inPublic('widget', 'valueSet'))).toBe(true);
    expect(aggregate.declaringSpaces(inPublic('widget', 'table'))).toEqual([]);
  });
});
