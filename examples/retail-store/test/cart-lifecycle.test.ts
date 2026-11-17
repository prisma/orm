import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { addToCart, clearCart, getCartByUserId, removeFromCart } from '../src/data/carts';
import { setupTestDb } from './setup';

const ITEM_SHIRT = {
  productId: 'prod-1',
  name: 'Shirt',
  brand: 'Heritage',
  amount: 1,
  price: { amount: 79.99, currency: 'USD' },
  image: { url: '/shirt.jpg' },
};

const ITEM_CHINOS = {
  productId: 'prod-2',
  name: 'Chinos',
  brand: 'UrbanEdge',
  amount: 1,
  price: { amount: 59.99, currency: 'USD' },
  image: { url: '/chinos.jpg' },
};

describe('cart lifecycle (integration)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const ctx = setupTestDb('cart_lifecycle_test');

  it('addToCart creates a cart when none exists', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM_SHIRT);

    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart).not.toBeNull();
    expect(cart!.items).toHaveLength(1);
    expect(cart!.items[0]).toMatchObject({ name: 'Shirt', productId: 'prod-1' });
  });

  it('addToCart appends to an existing cart', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Bob',
      email: 'bob@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM_SHIRT);
    await addToCart(ctx.db, user.id, ITEM_CHINOS);

    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart).not.toBeNull();
    expect(cart!.items).toHaveLength(2);
    const names = cart!.items.map((i) => i.name).sort();
    expect(names).toEqual(['Chinos', 'Shirt']);
  });

  it('removeFromCart removes item by productId', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Carol',
      email: 'carol@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM_SHIRT);
    await addToCart(ctx.db, user.id, ITEM_CHINOS);
    await removeFromCart(ctx.db, user.id, 'prod-1');

    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart).not.toBeNull();
    expect(cart!.items).toHaveLength(1);
    expect(cart!.items[0]!.productId).toBe('prod-2');
  });

  it('clearCart empties the items array', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Dave',
      email: 'dave@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM_SHIRT);
    await clearCart(ctx.db, user.id);

    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart).not.toBeNull();
    expect(cart!.items).toHaveLength(0);
  });

  it('full lifecycle: add → add → remove → clear', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Eve',
      email: 'eve@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM_SHIRT);
    const afterFirst = await getCartByUserId(ctx.db, user.id);
    expect(afterFirst!.items).toHaveLength(1);

    await addToCart(ctx.db, user.id, ITEM_CHINOS);
    const afterSecond = await getCartByUserId(ctx.db, user.id);
    expect(afterSecond!.items).toHaveLength(2);

    await removeFromCart(ctx.db, user.id, 'prod-1');
    const afterRemove = await getCartByUserId(ctx.db, user.id);
    expect(afterRemove!.items).toHaveLength(1);
    expect(afterRemove!.items[0]!.name).toBe('Chinos');

    await clearCart(ctx.db, user.id);
    const afterClear = await getCartByUserId(ctx.db, user.id);
    expect(afterClear!.items).toHaveLength(0);
  });
});
