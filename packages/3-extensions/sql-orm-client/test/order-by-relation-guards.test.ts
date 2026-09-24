import { describe, expect, it } from 'vitest';
import { compileSelect } from '../src/query-plan-select';
import { baseContract, createCollectionFor } from './collection-fixtures';

describe('cursor() after an order it cannot key on', () => {
  it('rejects a relation order and names its position', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy([(post) => post.id.asc(), (post) => post.author.name.asc()]);

    expect(() => ordered.cursor({ id: 1 })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 2'),
      }),
    );
  });

  it('rejects a relation count order', () => {
    const { collection } = createCollectionFor('User');
    const ordered = collection.orderBy((user) => user.posts.count().desc());

    expect(() => ordered.cursor({ id: 1 })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 1'),
      }),
    );
  });

  it('rejects an order with null placement', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy((post) => post.title.asc({ nulls: 'last' }));

    expect(() => ordered.cursor({ title: 'a' })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('nulls'),
      }),
    );
  });

  it('keeps accepting plain column orders', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.orderBy((post) => post.title.desc()).cursor({ title: 'a' }),
    ).not.toThrow();
  });

  it('refuses to build a keyset when a relation order follows the cursor', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy((post) => post.id.asc())
      .cursor({ id: 1 })
      .orderBy((post) => post.author.name.asc()).state;

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });

  it('refuses to build a keyset when an order with null placement follows the cursor', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .orderBy((post) => post.id.asc())
      .cursor({ id: 1 })
      .orderBy((post) => post.title.asc({ nulls: 'first' })).state;

    expect(() => compileSelect(baseContract, 'public', 'posts', state)).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });
});

describe('distinctOn() after a relation order', () => {
  it('rejects a relation order and names its position', () => {
    const { collection } = createCollectionFor('Post');
    const ordered = collection.orderBy([
      (post) => post.author.name.asc(),
      (post) => post.title.asc(),
    ]);

    expect(() => ordered.distinctOn('title')).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining('orderBy item 1'),
      }),
    );
  });

  it('keeps accepting column orders with null placement', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.orderBy((post) => post.title.asc({ nulls: 'last' })).distinctOn('title'),
    ).not.toThrow();
  });
});
