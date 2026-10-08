import { textColumn, timestamptzTemporalColumn } from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import type { Contract as FragmentNamespaceContract } from './fixtures/fragment-namespace/generated/contract';
import fragmentNamespaceJson from './fixtures/fragment-namespace/generated/contract.json' with {
  type: 'json',
};
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ScopeNamespaceContract } from './fixtures/scope-namespace/generated/contract';
import scopeNamespaceJson from './fixtures/scope-namespace/generated/contract.json' with {
  type: 'json',
};
import { createFragmentsOrm } from './fragments-fixture';
import { buildTestContextFromContract, createMockRuntime } from './helpers';

function untyped(fragment: unknown): (collection: unknown) => unknown {
  return blindCast<(collection: unknown) => unknown, 'a JavaScript caller'>(fragment);
}

const notDeleted = () =>
  createFragmentsOrm().client.fragment(
    { deletedAt: field.column(timestamptzTemporalColumn).optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );

describe('a fragment for any model checks what it is given and what its body returns', () => {
  it.each([
    ['undefined', 'undefined', undefined],
    ['null', 'null', null],
    ['a number', 'a number', 3],
    ['an object without ctx', 'an object', { modelName: 'Post' }],
    [
      'an object whose ctx is empty',
      'an object',
      { ctx: {}, modelName: 'Post', namespaceId: 'public' },
    ],
  ])('refuses %s as the collection', (_title, received, value) => {
    expect(() => untyped(notDeleted())(value)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the fragment: it was not given a collection',
        why: `A fragment is applied to a collection, such as db.orm.public.Post; received ${received}.`,
        fix: 'Pass the fragment to with on a collection: collection.with(fragment).',
      }),
    );
  });

  it('refuses a body that returns a collection of another model', () => {
    const { client, plain } = createFragmentsOrm();
    const elsewhere = blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
      client.fragment,
    )({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, () => plain.Comment);
    expect(() => untyped(elsewhere)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the fragment to Post: its body did not return a collection of Post',
        meta: { model: 'Post', namespace: 'public', returned: 'Comment' },
      }),
    );
  });

  it('refuses a body that returns something other than a collection', () => {
    const { client, plain } = createFragmentsOrm();
    const nothing = blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
      client.fragment,
    )({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, () => undefined);
    expect(() => untyped(nothing)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        why: 'The body of a fragment for any model returns the collection it received, after where, orderBy, limit or offset; it returned undefined.',
      }),
    );
  });

  it('refuses a field that only a variant has, on the base model and on the variant', () => {
    const contract = new PostgresContractSerializer().deserializeContract<PolyContract>(
      polyContractJson,
    );
    const client = orm({
      runtime: createMockRuntime(),
      context: buildTestContextFromContract(contract),
    });
    const bySeverity = client.fragment({ severity: field.column(textColumn) }, (rows) =>
      rows.where((r) => r.severity.eq('high')),
    );
    const tasks = client.public.Task;
    for (const collection of [tasks, tasks.variant('bug')]) {
      expect(() => untyped(bySeverity)(collection)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          message: 'Cannot apply a fragment to Task: it has no field severity',
        }),
      );
    }
  });
});

describe('a fragment for one model checks the collection it is applied to', () => {
  it('refuses a collection of another model', () => {
    const { plain } = createFragmentsOrm();
    const titles = plain.Post.fragment((posts) => posts.select('id', 'title'));
    expect(() => untyped(titles)(plain.Comment)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply a fragment for public.Post to a collection of public.Comment',
        meta: {
          model: 'Post',
          namespace: 'public',
          receivedModel: 'Comment',
          receivedNamespace: 'public',
        },
      }),
    );
  });

  it('refuses something other than a collection', () => {
    const { plain } = createFragmentsOrm();
    const titles = plain.Post.fragment((posts) => posts.select('id', 'title'));
    expect(() => untyped(titles)(null)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the fragment: it was not given a collection',
      }),
    );
  });
});

type PlainPublic = ReturnType<typeof createFragmentsOrm>['plain'];

const viewed = (plain: PlainPublic) => plain.Post.where((p) => p.views.gte(1));
const afterCursor = (plain: PlainPublic) =>
  viewed(plain)
    .orderBy((p) => p.id.asc())
    .cursor({ id: 5 });
const distinctTitles = (plain: PlainPublic) => viewed(plain).distinct('title');
const distinctOnUser = (plain: PlainPublic) =>
  viewed(plain)
    .orderBy((p) => p.userId.asc())
    .distinctOn('userId');

describe('bulk writes refuse what they would ignore', () => {
  const recentTen = () =>
    createFragmentsOrm().client.fragment(
      { deletedAt: field.column(timestamptzTemporalColumn).optional() },
      (rows) => rows.where((r) => r.deletedAt.isNull()).limit(10),
    );

  it('refuses deleteAll after a fragment with a limit, before any statement runs', () => {
    const { plain, runtime } = createFragmentsOrm();
    expect(() => plain.Post.with(recentTen()).deleteAll()).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot deleteAll Post: the collection has a limit',
        why: 'deleteAll changes every row that matches the filter. The statement it runs cannot apply a limit, so it would change more rows than the chain asks for. A fragment passed to with can add one without showing it at the call site.',
        fix: 'Remove limit() before deleteAll, or read the rows first and change them by their ids.',
        meta: { model: 'Post', method: 'deleteAll', limit: 10 },
      }),
    );
    expect(runtime.executions).toEqual([]);
  });

  it('refuses deleteAll and updateAll after a limit or offset written inline', () => {
    const { plain } = createFragmentsOrm();
    expect(() => viewed(plain).limit(10).deleteAll()).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
    expect(() => viewed(plain).offset(5).updateAll({ title: 'x' })).toThrow(
      expect.objectContaining({
        message: 'Cannot updateAll Post: the collection has an offset',
      }),
    );
  });

  it('refuses updateAndCount and deleteAndCount after a limit', async () => {
    const { plain, runtime } = createFragmentsOrm();
    const limited = viewed(plain).limit(3);
    await expect(limited.updateAndCount({ title: 'x' })).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message: 'Cannot updateAndCount Post: the collection has a limit',
    });
    await expect(limited.deleteAndCount()).rejects.toMatchObject({
      message: 'Cannot deleteAndCount Post: the collection has a limit',
    });
    expect(runtime.executions).toEqual([]);
  });

  it.each([
    ['a cursor', 'cursor()', afterCursor, { cursor: { id: 5 } }],
    ['a distinct selection', 'distinct()', distinctTitles, { distinct: ['title'] }],
    ['a distinctOn selection', 'distinctOn()', distinctOnUser, { distinctOn: ['user_id'] }],
  ])(
    'refuses each bulk write after %s, before any statement runs',
    async (noun, call, chain, meta) => {
      const { plain, runtime } = createFragmentsOrm();
      const writes = {
        updateAll: () => chain(plain).updateAll({ title: 'x' }),
        updateAndCount: () => chain(plain).updateAndCount({ title: 'x' }),
        deleteAll: () => chain(plain).deleteAll(),
        deleteAndCount: () => chain(plain).deleteAndCount(),
      };
      for (const [method, write] of Object.entries(writes)) {
        await expect((async () => write())()).rejects.toMatchObject({
          code: 'ORM.ARGUMENT_INVALID',
          message: `Cannot ${method} Post: the collection has ${noun}`,
          why: `${method} changes every row that matches the filter. The statement it runs cannot apply ${noun}, so it would change more rows than the chain asks for. A fragment passed to with can add one without showing it at the call site.`,
          fix: `Remove ${call} before ${method}, or read the rows first and change them by their ids.`,
          meta: { model: 'Post', method, ...meta },
        });
      }
      expect(runtime.executions).toEqual([]);
    },
  );

  it('names everything the collection has that the write would ignore', () => {
    const { plain } = createFragmentsOrm();
    expect(() => afterCursor(plain).limit(3).offset(2).deleteAll()).toThrow(
      expect.objectContaining({
        message: 'Cannot deleteAll Post: the collection has a limit, an offset and a cursor',
        why: 'deleteAll changes every row that matches the filter. The statement it runs cannot apply a limit, an offset or a cursor, so it would change more rows than the chain asks for. A fragment passed to with can add one without showing it at the call site.',
        fix: 'Remove limit(), offset() and cursor() before deleteAll, or read the rows first and change them by their ids.',
      }),
    );
  });

  it('still allows writes after an order alone', () => {
    const { plain } = createFragmentsOrm();
    expect(() =>
      viewed(plain)
        .orderBy((p) => p.views.desc())
        .deleteAll(),
    ).not.toThrow();
  });
});

describe('update and delete change the row first() returns', () => {
  const thirdByViews = (plain: PlainPublic) =>
    viewed(plain)
      .orderBy((p) => p.views.desc())
      .offset(2);

  it('update finds its row with the order and the offset', async () => {
    const { plain, runtime } = createFragmentsOrm();
    runtime.setNextResults([[{ id: 7 }], [{ id: 7, title: 'x' }]]);
    await thirdByViews(plain).update({ title: 'x' });
    await thirdByViews(plain).select('id').first();
    const [lookup, , first] = runtime.executions;
    expect(lookup?.plan.ast).toMatchObject({ offset: 2, limit: 1 });
    expect(lookup?.plan.ast).toEqual(first?.plan.ast);
  });

  it('delete finds its row with the order and the offset', async () => {
    const { plain, runtime } = createFragmentsOrm();
    runtime.setNextResults([[{ id: 7 }], [{ id: 7, title: 'x' }]]);
    await thirdByViews(plain).delete();
    await thirdByViews(plain).select('id').first();
    const [lookup, , first] = runtime.executions;
    expect(lookup?.plan.ast).toMatchObject({ offset: 2, limit: 1 });
    expect(lookup?.plan.ast).toEqual(first?.plan.ast);
  });

  it.each([
    ['a cursor', afterCursor],
    ['a distinct selection', distinctTitles],
    ['a distinctOn selection', distinctOnUser],
  ])('update and delete find their row with %s, as first() does', async (_, chain) => {
    const { plain, runtime } = createFragmentsOrm();
    runtime.setNextResults([[{ id: 7 }], [{ id: 7, title: 'x' }], [{ id: 7 }], [{ id: 7 }]]);
    await chain(plain).update({ title: 'x' });
    await chain(plain).delete();
    await chain(plain).select('id').first();
    const [updateLookup, , deleteLookup, , first] = runtime.executions;
    expect(first?.plan.ast).toBeDefined();
    expect(updateLookup?.plan.ast).toEqual(first?.plan.ast);
    expect(deleteLookup?.plan.ast).toEqual(first?.plan.ast);
  });

  it('update and delete after limit(0) change nothing and return null', async () => {
    const { plain, runtime } = createFragmentsOrm();
    const none = viewed(plain).limit(0);
    expect(await none.update({ title: 'x' })).toBeNull();
    expect(await none.delete()).toBeNull();
    expect(runtime.executions).toEqual([]);
  });

  it.each([
    [
      'limit',
      'limit must be an integer from 0 to 9007199254740991, got -1',
      (plain: PlainPublic) => viewed(plain).limit(-1),
    ],
    [
      'limit',
      'limit must be an integer from 0 to 9007199254740991, got 1.5',
      (plain: PlainPublic) => viewed(plain).limit(1.5),
    ],
    [
      'offset',
      'offset must be an integer from 0 to 9007199254740991, got -2',
      (plain: PlainPublic) => viewed(plain).offset(-2),
    ],
  ])('update and delete refuse a %s that a read refuses', async (_, message, chain) => {
    const { plain, runtime } = createFragmentsOrm();
    const refused = expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID', message });
    expect(() => chain(plain).all()).toThrow(refused);
    await expect(chain(plain).update({ title: 'x' })).rejects.toThrow(refused);
    await expect(chain(plain).delete()).rejects.toThrow(refused);
    expect(runtime.executions).toEqual([]);
  });

  it('delete with an include reads the row it deletes without the offset', async () => {
    const { plain, runtime } = createFragmentsOrm();
    runtime.setNextResults([[{ id: 7 }], [{ id: 7, title: 'x', user: null }]]);
    await thirdByViews(plain).include('user').delete();
    const [, readBack] = runtime.executions;
    expect(readBack?.plan.ast).toMatchObject({ offset: undefined });
  });

  it.each([
    [
      'an order',
      (plain: PlainPublic) => plain.Post.where({ userId: 1 }).orderBy((p) => p.id.asc()),
    ],
    ['a limit', (plain: PlainPublic) => plain.Post.where({ userId: 1 }).limit(1)],
    ['an offset', (plain: PlainPublic) => plain.Post.where({ userId: 1 }).offset(2)],
    ['an order and a cursor', afterCursor],
    ['a distinct selection', distinctTitles],
    ['an order and a distinctOn selection', distinctOnUser],
  ])('refuses an update that changes a relation after %s', async (noun, chain) => {
    const { plain, runtime } = createFragmentsOrm();
    await expect(
      chain(plain).update({ comments: (comments) => comments.connect([{ id: 1 }]) }),
    ).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message: `Cannot update Post with a relation mutation: the collection has ${noun}`,
      why: `An update that changes a relation finds its row by the filter alone. It would ignore ${noun}, and could change another row than first() returns. A fragment passed to with can add one without showing it at the call site.`,
    });
    expect(runtime.executions).toEqual([]);
  });
});

describe('a contract with a namespace named fragment', () => {
  const contract = new PostgresContractSerializer().deserializeContract<FragmentNamespaceContract>(
    fragmentNamespaceJson,
  );
  const client = orm({
    runtime: createMockRuntime(),
    context: buildTestContextFromContract(contract),
  });

  it('keeps the namespace under the name fragment, in place of the client method', () => {
    expect(typeof client.fragment).toBe('object');
    expect(client.fragment.Audit.modelName).toBe('Audit');
    expect(typeof client.fragment.Audit.fragment).toBe('function');
    expect(client.public.Post.modelName).toBe('Post');
  });
});

describe('a contract with a namespace named scope', () => {
  const contract = new PostgresContractSerializer().deserializeContract<ScopeNamespaceContract>(
    scopeNamespaceJson,
  );
  const client = orm({
    runtime: createMockRuntime(),
    context: buildTestContextFromContract(contract),
  });

  it('keeps both the namespace and the fragment method', () => {
    expect(client.scope.Audit.modelName).toBe('Audit');
    const titled = client.fragment({ title: field.column(textColumn) }, (rows) =>
      rows.where((r) => r.title.eq('x')),
    );
    expect(client.public.Post.with(titled).state.filters).toHaveLength(1);
  });
});
