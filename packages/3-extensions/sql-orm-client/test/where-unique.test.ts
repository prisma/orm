import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { createCollectionTables } from '../src/collection-tables';
import { createModelAccessor } from '../src/model-accessor';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';
import {
  buildCompositeForeignKeyContract,
  buildMixedPolyContract,
  buildTestContextFromContract,
  createMockRuntime,
  getTestContext,
} from './helpers';

describe('whereUnique', () => {
  it('records the same filter as where with the same object', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.whereUnique({ id: 1 });
    expect(unique.state.filters).toHaveLength(1);
    expect(unique.state).toEqual(db.Post.where({ id: 1 }).state);
  });

  it('records the same filter as where for a compound key', () => {
    const { plain } = createChainingOrm();
    const unique = plain.Project.whereUnique({ tenantId: 1, id: 2 });
    expect(unique.state.filters).toHaveLength(1);
    expect(unique.state).toEqual(plain.Project.where({ tenantId: 1, id: 2 }).state);
  });

  it('adds its filter to the filters already applied', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.where({ title: 'x' }).whereUnique({ id: 1 });
    expect(unique.state.filters).toHaveLength(2);
    expect(unique.state).toEqual(db.Post.where({ title: 'x' }).where({ id: 1 }).state);
  });

  it('keeps the class and leaves the receiver unchanged', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.whereUnique({ id: 1 });
    expect(unique).toBeInstanceOf(PostCollection);
    expect(unique).not.toBe(db.Post);
    expect(db.Post.state.filters).toHaveLength(0);
  });

  it('first reads with the same plan as where with the same object', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.whereUnique({ id: 1 }).first();
    await db.Post.where({ id: 1 }).first();
    await db.Post.first();
    expect(runtime.executions).toHaveLength(3);
    const [unique, filtered, unfiltered] = runtime.executions;
    expect(unique?.plan.ast).toBeDefined();
    expect(unique?.plan.ast).toEqual(filtered?.plan.ast);
    expect(unique?.plan.ast).not.toEqual(unfiltered?.plan.ast);
  });

  it('delete writes with the same plan as where with the same object', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.whereUnique({ id: 1 }).delete();
    await db.Post.where({ id: 1 }).delete();
    expect(runtime.executions).toHaveLength(2);
    const [unique, filtered] = runtime.executions;
    expect(unique?.plan.ast).toBeDefined();
    expect(unique?.plan.ast).toEqual(filtered?.plan.ast);
  });

  it('throws inside an include refinement reached through a model fragment', () => {
    const { plain } = createChainingOrm();
    const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));
    const onePost = plain.Post.fragment((posts) => posts.whereUnique({ id: 1 }).with(summary));
    expect(() => plain.User.include('posts', (posts) => posts.with(onePost))).toThrow(
      expect.objectContaining({
        code: 'ORM.INCLUDE_INVALID',
        message: 'whereUnique() is not available inside include() refinement callbacks',
        meta: { action: 'whereUnique()' },
      }),
    );
  });

  it('the same model fragment works on a top-level collection', () => {
    const { plain } = createChainingOrm();
    const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));
    const onePost = plain.Post.fragment((posts) => posts.whereUnique({ id: 1 }).with(summary));
    expect(plain.Post.with(onePost).state).toEqual(
      plain.Post.where({ id: 1 }).select('id', 'title').state,
    );
  });
});

describe('whereUnique with a criterion that does not hold a complete key', () => {
  const incompleteKey = {
    code: 'ORM.ARGUMENT_INVALID',
    message:
      'whereUnique() for model "Post" needs a value for every field of the primary key or of one unique constraint',
    meta: { method: 'whereUnique', argument: 'criterion', model: 'Post' },
  };

  function projectError(model: string) {
    return expect.objectContaining({
      code: 'ORM.ARGUMENT_INVALID',
      message: `whereUnique() for model "${model}" needs a value for every field of the primary key or of one unique constraint`,
      meta: { method: 'whereUnique', argument: 'criterion', model },
    });
  }

  it('throws when every value is undefined', () => {
    const { db, runtime } = createChainingOrm();
    const criterion = { id: undefined } as unknown as { id: number };
    expect(() => db.Post.whereUnique(criterion)).toThrow(expect.objectContaining(incompleteKey));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when one field of a compound key is undefined', () => {
    const { plain, runtime } = createChainingOrm();
    const criterion = { tenantId: 1, id: undefined } as unknown as { tenantId: number; id: number };
    expect(() => plain.Project.whereUnique(criterion)).toThrow(projectError('Project'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when one field of a compound key is missing', () => {
    const { plain, runtime } = createChainingOrm();
    const criterion = { tenantId: 1 } as unknown as { tenantId: number; id: number };
    expect(() => plain.Project.whereUnique(criterion)).toThrow(projectError('Project'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when a key field is null', () => {
    const { plain, runtime } = createChainingOrm();
    const criterion = { email: null } as unknown as { email: string };
    expect(() => plain.User.whereUnique(criterion)).toThrow(projectError('User'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when the object has only a field that is not a key', () => {
    const { db, runtime } = createChainingOrm();
    const criterion = { title: 'x' } as unknown as { id: number };
    expect(() => db.Post.whereUnique(criterion)).toThrow(expect.objectContaining(incompleteKey));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws as where does for a key given by its column name', () => {
    const { plain, runtime } = createChainingOrm();
    const byColumn = { user_id: 1 } as unknown as { userId: number };
    const fieldUnknown = expect.objectContaining({
      code: 'ORM.FIELD_UNKNOWN',
      meta: { model: 'Profile', field: 'user_id', fieldForColumn: 'userId' },
    });
    expect(() => plain.Profile.where(byColumn)).toThrow(fieldUnknown);
    expect(() => plain.Profile.whereUnique(byColumn)).toThrow(fieldUnknown);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws as where does for a name that is not a field, next to a complete key', () => {
    const { db } = createChainingOrm();
    const withUnknown = { id: 1, nope: 'x' } as unknown as { id: number };
    const fieldUnknown = expect.objectContaining({
      code: 'ORM.FIELD_UNKNOWN',
      meta: { model: 'Post', field: 'nope' },
    });
    expect(() => db.Post.where(withUnknown)).toThrow(fieldUnknown);
    expect(() => db.Post.whereUnique(withUnknown)).toThrow(fieldUnknown);
  });

  it('does not count a key given by its column name with an undefined value', () => {
    const { plain } = createChainingOrm();
    const byColumn = { user_id: undefined } as unknown as { userId: number };
    expect(() => plain.Profile.whereUnique(byColumn)).toThrow(projectError('Profile'));
  });

  it('does not put the values of the criterion in the message', () => {
    const { plain } = createChainingOrm();
    const criterion = { tenantId: 987654, id: undefined } as unknown as {
      tenantId: number;
      id: number;
    };
    expect(() => plain.Project.whereUnique(criterion)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('987654') }),
    );
  });

  it('throws inside an include refinement with the refinement error, not the key error', () => {
    const { plain } = createChainingOrm();
    const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));
    const noKey = plain.Post.fragment((posts) =>
      posts.whereUnique({ id: undefined } as unknown as { id: number }).with(summary),
    );
    expect(() => plain.User.include('posts', (posts) => posts.with(noKey))).toThrow(
      expect.objectContaining({ code: 'ORM.INCLUDE_INVALID' }),
    );
  });
});

describe('whereUnique with a criterion that is not an object', () => {
  const incompleteKey = expect.objectContaining({
    code: 'ORM.ARGUMENT_INVALID',
    message:
      'whereUnique() for model "Post" needs a value for every field of the primary key or of one unique constraint',
    meta: { method: 'whereUnique', argument: 'criterion', model: 'Post' },
  });

  function whereUniqueWith(criterion: unknown) {
    const { db, runtime } = createChainingOrm();
    const call = () => db.Post.whereUnique(criterion as { id: number });
    return { call, runtime };
  }

  it('throws for null', () => {
    const { call, runtime } = whereUniqueWith(null);
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when the criterion is omitted', () => {
    const { db, runtime } = createChainingOrm();
    const whereUnique = db.Post.whereUnique.bind(db.Post) as unknown as () => unknown;
    expect(() => whereUnique()).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for an empty array', () => {
    const { call, runtime } = whereUniqueWith([]);
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for an array of values', () => {
    const { call, runtime } = whereUniqueWith([1]);
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for a string', () => {
    const { call, runtime } = whereUniqueWith('1');
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for an empty string', () => {
    const { call, runtime } = whereUniqueWith('');
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for a number', () => {
    const { call, runtime } = whereUniqueWith(1);
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for a function', () => {
    const { call, runtime } = whereUniqueWith(() => ({ id: 1 }));
    expect(call).toThrow(incompleteKey);
    expect(runtime.executions).toHaveLength(0);
  });
});

describe('whereUnique with a query expression as a key value', () => {
  function incompleteKey(model: string) {
    return expect.objectContaining({
      code: 'ORM.ARGUMENT_INVALID',
      message: `whereUnique() for model "${model}" needs a value for every field of the primary key or of one unique constraint`,
      meta: { method: 'whereUnique', argument: 'criterion', model },
    });
  }

  it('throws for an expression for the same column', () => {
    const { db, runtime } = createChainingOrm();
    const post = createModelAccessor(
      getTestContext(),
      'public',
      'Post',
      createCollectionTables(getTestContext().contract, 'public', 'Post'),
    );
    const criterion = { id: post.id } as unknown as { id: number };
    expect(() => db.Post.whereUnique(criterion)).toThrow(incompleteKey('Post'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for an expression for another column of the model', () => {
    const { db, runtime } = createChainingOrm();
    const post = createModelAccessor(
      getTestContext(),
      'public',
      'Post',
      createCollectionTables(getTestContext().contract, 'public', 'Post'),
    );
    const criterion = { id: post.views } as unknown as { id: number };
    expect(() => db.Post.whereUnique(criterion)).toThrow(incompleteKey('Post'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws for a compound key with one field given as an expression', () => {
    const { plain, runtime } = createChainingOrm();
    const project = createModelAccessor(
      getTestContext(),
      'public',
      'Project',
      createCollectionTables(getTestContext().contract, 'public', 'Project'),
    );
    const criterion = { tenantId: 1, id: project.id } as unknown as {
      tenantId: number;
      id: number;
    };
    expect(() => plain.Project.whereUnique(criterion)).toThrow(incompleteKey('Project'));
    expect(runtime.executions).toHaveLength(0);
  });

  it('compiles an expression on a field outside the key as a further filter', () => {
    const { db } = createChainingOrm();
    const post = createModelAccessor(
      getTestContext(),
      'public',
      'Post',
      createCollectionTables(getTestContext().contract, 'public', 'Post'),
    );
    const criterion = { id: 1, views: post.userId } as unknown as { id: number };
    const unique = db.Post.whereUnique(criterion);
    expect(unique.state.filters).toHaveLength(1);
    expect(unique.state).toEqual(db.Post.where({ id: 1, views: post.userId }).state);
  });
});

describe('whereUnique with a complete key', () => {
  it('accepts a complete unique constraint that is not the primary key', () => {
    const { plain } = createChainingOrm();
    expect(plain.User.whereUnique({ email: 'a@example.com' }).state).toEqual(
      plain.User.where({ email: 'a@example.com' }).state,
    );
  });

  it('accepts a unique constraint whose column name differs from its field name', () => {
    const { plain } = createChainingOrm();
    expect(plain.Profile.whereUnique({ userId: 1 }).state).toEqual(
      plain.Profile.where({ userId: 1 }).state,
    );
  });

  it('drops a field outside the key whose value is undefined', () => {
    const { db } = createChainingOrm();
    const criterion = { id: 1, title: undefined } as unknown as { id: number };
    expect(db.Post.whereUnique(criterion).state).toEqual(db.Post.where({ id: 1 }).state);
  });

  it('compiles a defined field outside the key as a further filter', () => {
    const { db } = createChainingOrm();
    const criterion = { id: 1, title: 'x' } as unknown as { id: number };
    expect(db.Post.whereUnique(criterion).state).toEqual(
      db.Post.where({ id: 1, title: 'x' }).state,
    );
  });

  it('accepts a complete key next to another key whose value is undefined', () => {
    const { plain } = createChainingOrm();
    const criterion = { id: 1, email: undefined } as unknown as { id: number };
    expect(plain.User.whereUnique(criterion).state).toEqual(plain.User.where({ id: 1 }).state);
  });
});

describe('whereUnique on a contract written with defineContract, whose argument type accepts any record', () => {
  function customers() {
    const contract = buildCompositeForeignKeyContract();
    const runtime = createMockRuntime();
    const context = buildTestContextFromContract(contract);
    const collection = new Collection({ runtime, context }, 'Customer', {
      namespaceId: 'public',
    });
    return { collection, runtime, context };
  }

  it('accepts a complete compound key', () => {
    const { collection } = customers();
    expect(collection.whereUnique({ tenantId: 1, id: 2 }).state).toEqual(
      collection.where({ tenantId: 1, id: 2 }).state,
    );
  });

  it('throws when one field of the compound key is an expression', () => {
    const { collection, runtime, context } = customers();
    const customer = createModelAccessor(
      context,
      'public',
      'Customer',
      createCollectionTables(context.contract, 'public', 'Customer'),
    );
    const criterion = { tenantId: 1, id: customer.id } as unknown as {
      tenantId: number;
      id: number;
    };
    expect(() => collection.whereUnique(criterion)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        meta: { method: 'whereUnique', argument: 'criterion', model: 'Customer' },
      }),
    );
    expect(runtime.executions).toHaveLength(0);
  });

  it('throws when one field of the compound key is undefined', () => {
    const { collection, runtime } = customers();
    const criterion = { tenantId: 1, id: undefined } as unknown as { tenantId: number; id: number };
    expect(() => collection.whereUnique(criterion)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        meta: { method: 'whereUnique', argument: 'criterion', model: 'Customer' },
      }),
    );
    expect(runtime.executions).toHaveLength(0);
  });
});

describe('whereUnique where a statement names its tables through the scope', () => {
  function plans(runtime: { executions: readonly { plan: { ast: unknown } }[] }) {
    const asts = runtime.executions.map((execution) => execution.plan.ast);
    const half = asts.length / 2;
    return { first: asts.slice(0, half), second: asts.slice(half), count: asts.length };
  }

  it('an include of a self-relation reads with the same plans as after where', async () => {
    const { plain, runtime } = createChainingOrm();
    const unique = plain.User.whereUnique({ id: 1 }).include('invitedUsers').include('invitedBy');
    const filtered = plain.User.where({ id: 1 }).include('invitedUsers').include('invitedBy');
    await unique.first();
    await filtered.first();
    const { first, second, count } = plans(runtime);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(first).toEqual(second);
  });

  it('update writes with the same plans as after where', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.whereUnique({ id: 1 }).update({ title: 'y' });
    await db.Post.where({ id: 1 }).update({ title: 'y' });
    const { first, second, count } = plans(runtime);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(first).toEqual(second);
  });

  it('a variant with its own table reads with the same plans as after where', async () => {
    const runtime = createMockRuntime();
    const context = { ...getTestContext(), contract: buildMixedPolyContract() };
    const tasks = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
    const unique = tasks.whereUnique({ id: 1 } as never).variant('feature' as never);
    const filtered = tasks.where({ id: 1 } as never).variant('feature' as never);
    expect(unique.state).toEqual(filtered.state);
    await unique.first();
    await filtered.first();
    const { first, second, count } = plans(runtime);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(first).toEqual(second);
  });
});
