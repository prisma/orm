import { textColumn, timestamptzTemporalColumn } from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import type { Contract as ScopeNamespaceContract } from './fixtures/scope-namespace/generated/contract';
import scopeNamespaceJson from './fixtures/scope-namespace/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime } from './helpers';
import { createScopesOrm } from './scopes-fixture';

function untyped(scope: unknown): (collection: unknown) => unknown {
  return blindCast<(collection: unknown) => unknown, 'a JavaScript caller'>(scope);
}

const notDeleted = () =>
  createScopesOrm().client.scope(
    { deletedAt: field.column(timestamptzTemporalColumn).optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );

describe('a scope for any model checks what it is given and what its body returns', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 3],
    ['an object', { modelName: 'Post' }],
  ])('refuses %s as the collection', (description, value) => {
    expect(() => untyped(notDeleted())(value)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the scope: it was not given a collection',
        why: `A scope is applied to a collection, such as db.orm.public.Post; received ${description}.`,
      }),
    );
  });

  it('refuses a body that returns a collection of another model', () => {
    const { client, plain } = createScopesOrm();
    const elsewhere = blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
      client.scope,
    )({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, () => plain.Comment);
    expect(() => untyped(elsewhere)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the scope to Post: its body did not return a collection of Post',
        meta: { model: 'Post', namespace: 'public', returned: 'Comment' },
      }),
    );
  });

  it('refuses a body that returns something other than a collection', () => {
    const { client, plain } = createScopesOrm();
    const nothing = blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
      client.scope,
    )({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, () => undefined);
    expect(() => untyped(nothing)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        why: 'The body of a scope for any model returns the collection it received, after where, orderBy, limit or offset; it returned undefined.',
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
    const bySeverity = client.scope({ severity: field.column(textColumn) }, (rows) =>
      rows.where((r) => r.severity.eq('high')),
    );
    const tasks = client.public.Task;
    for (const collection of [tasks, tasks.variant('Bug')]) {
      expect(() => untyped(bySeverity)(collection)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          message: 'Cannot apply a scope to Task: it has no field severity',
        }),
      );
    }
  });
});

describe('a scope for one model checks the collection it is applied to', () => {
  it('refuses a collection of another model', () => {
    const { plain } = createScopesOrm();
    const titles = plain.Post.scope((posts) => posts.select('id', 'title'));
    expect(() => untyped(titles)(plain.Comment)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply a scope for public.Post to a collection of public.Comment',
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
    const { plain } = createScopesOrm();
    const titles = plain.Post.scope((posts) => posts.select('id', 'title'));
    expect(() => untyped(titles)(null)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot apply the scope: it was not given a collection',
      }),
    );
  });
});

describe('writes refuse a limit or an offset they would ignore', () => {
  const recentTen = () =>
    createScopesOrm().client.scope(
      { deletedAt: field.column(timestamptzTemporalColumn).optional() },
      (rows) => rows.where((r) => r.deletedAt.isNull()).limit(10),
    );

  it('refuses deleteAll after a scope with a limit, before any statement runs', () => {
    const { plain, runtime } = createScopesOrm();
    expect(() => plain.Post.apply(recentTen()).deleteAll()).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot deleteAll Post: the collection has a limit or an offset',
        meta: { model: 'Post', method: 'deleteAll', limit: 10, offset: undefined },
      }),
    );
    expect(runtime.executions).toEqual([]);
  });

  it('refuses deleteAll and updateAll after a limit or offset written inline', () => {
    const { plain } = createScopesOrm();
    expect(() =>
      plain.Post.where((p) => p.views.gte(1))
        .limit(10)
        .deleteAll(),
    ).toThrow(expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }));
    expect(() =>
      plain.Post.where((p) => p.views.gte(1))
        .offset(5)
        .updateAll({ title: 'x' }),
    ).toThrow(
      expect.objectContaining({
        message: 'Cannot updateAll Post: the collection has a limit or an offset',
      }),
    );
  });

  it('refuses update, updateAndCount and deleteAndCount after a limit', async () => {
    const { plain, runtime } = createScopesOrm();
    const limited = plain.Post.where((p) => p.views.gte(1)).limit(3);
    await expect(limited.update({ title: 'x' })).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message: 'Cannot update Post: the collection has a limit or an offset',
    });
    await expect(limited.updateAndCount({ title: 'x' })).rejects.toMatchObject({
      message: 'Cannot updateAndCount Post: the collection has a limit or an offset',
    });
    await expect(limited.deleteAndCount()).rejects.toMatchObject({
      message: 'Cannot deleteAndCount Post: the collection has a limit or an offset',
    });
    expect(runtime.executions).toEqual([]);
  });

  it('still allows writes after an order alone', () => {
    const { plain } = createScopesOrm();
    expect(() =>
      plain.Post.where((p) => p.views.gte(1))
        .orderBy((p) => p.views.desc())
        .deleteAll(),
    ).not.toThrow();
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

  it('keeps the namespace under the name, and the client has no scope method', () => {
    expect(client.scope.Audit.modelName).toBe('Audit');
    expect(typeof client.scope.Audit.scope).toBe('function');
    expect(client.public.Post.modelName).toBe('Post');
  });
});
