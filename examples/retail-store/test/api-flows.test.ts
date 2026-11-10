import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { addToCart, clearCart, getCartByUserId } from '../src/data/carts';
import {
  createOrder,
  deleteOrder,
  getOrderById,
  getOrderWithUser,
  getUserOrders,
  updateOrderStatus,
} from '../src/data/orders';
import { enums } from '../src/enums';
import { setupTestDb } from './setup';

const ITEM_A = {
  productId: 'prod-1',
  name: 'Shirt',
  brand: 'Heritage',
  amount: 1,
  price: { amount: 79.99, currency: 'USD' },
  image: { url: '/images/products/shirt.jpg' },
};

const ITEM_B = {
  productId: 'prod-2',
  name: 'Chinos',
  brand: 'UrbanEdge',
  amount: 2,
  price: { amount: 59.99, currency: 'USD' },
  image: { url: '/images/products/chinos.jpg' },
};

describe('API flow: order ownership (auth guard)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const ctx = setupTestDb('api_flows_order_auth');

  it('other user cannot see the order in their list', async () => {
    const alice = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'a@test.com',
      address: null,
    });
    const bob = await ctx.db.orm.users.create({
      name: 'Bob',
      email: 'b@test.com',
      address: null,
    });

    const order = await createOrder(ctx.db, {
      userId: alice.id,
      items: [ITEM_A],
      shippingAddress: '123 Main St',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const orderId = order.id;
    const fetched = await getOrderWithUser(ctx.db, orderId);
    expect(fetched).not.toBeNull();
    // `alice.id` comes back from `orm.users.create()` as the raw driver
    // value (an ObjectId); `fetched!.userId` is decoded to a hex string by
    // the typed-read path. Compare via String(...) until create() decodes
    // its return value (separate change).
    expect(fetched!.userId).toEqual(String(alice.id));

    const bobOrders = await getUserOrders(ctx.db, bob.id);
    expect(bobOrders).toHaveLength(0);
  });

  it('user can only see their own orders via getUserOrders', async () => {
    const alice = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'a@test.com',
      address: null,
    });
    const bob = await ctx.db.orm.users.create({
      name: 'Bob',
      email: 'b@test.com',
      address: null,
    });

    await createOrder(ctx.db, {
      userId: alice.id,
      items: [ITEM_A],
      shippingAddress: '123 Main St',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await createOrder(ctx.db, {
      userId: bob.id,
      items: [ITEM_B],
      shippingAddress: '456 Oak Ave',
      type: enums.OrderType.members.Pickup,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const aliceOrders = await getUserOrders(ctx.db, alice.id);
    const bobOrders = await getUserOrders(ctx.db, bob.id);

    expect(aliceOrders).toHaveLength(1);
    expect(bobOrders).toHaveLength(1);
    expect(aliceOrders[0]!.shippingAddress).toBe('123 Main St');
    expect(bobOrders[0]!.shippingAddress).toBe('456 Oak Ave');
  });

  it('deleteOrder only removes the targeted order', async () => {
    const alice = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'a@test.com',
      address: null,
    });

    const order1 = await createOrder(ctx.db, {
      userId: alice.id,
      items: [ITEM_A],
      shippingAddress: '123 Main St',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const order2 = await createOrder(ctx.db, {
      userId: alice.id,
      items: [ITEM_B],
      shippingAddress: '456 Oak Ave',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await deleteOrder(ctx.db, order1.id);

    const remaining = await getUserOrders(ctx.db, alice.id);
    expect(remaining).toHaveLength(1);
    // Same shape mismatch as above: `order2.id` comes from create() (raw
    // ObjectId), the `remaining[0]!.id` from a typed read (decoded hex).
    expect(remaining[0]!.id).toEqual(String(order2.id));
  });
});

describe('API flow: checkout (cart → order → clear)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const ctx = setupTestDb('api_flows_checkout');

  it('creates order from cart items and clears the cart server-side', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Carol',
      email: 'c@test.com',
      address: null,
    });
    const userId = user.id;

    await addToCart(ctx.db, userId, ITEM_A);
    await addToCart(ctx.db, userId, ITEM_B);

    const cart = await getCartByUserId(ctx.db, userId);
    expect(cart!.items).toHaveLength(2);

    const order = await createOrder(ctx.db, {
      userId,
      items: cart!.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        brand: item.brand,
        amount: item.amount,
        price: { amount: item.price.amount, currency: item.price.currency },
        image: { url: item.image.url },
      })),
      shippingAddress: '789 Elm Blvd',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await clearCart(ctx.db, userId);

    expect(order.items).toHaveLength(2);
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ status: 'placed' });

    const clearedCart = await getCartByUserId(ctx.db, userId);
    expect(clearedCart!.items).toHaveLength(0);
  });

  it('order retains items after cart is cleared', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Dave',
      email: 'd@test.com',
      address: null,
    });
    const userId = user.id;

    await addToCart(ctx.db, userId, ITEM_A);
    const cart = await getCartByUserId(ctx.db, userId);

    const order = await createOrder(ctx.db, {
      userId,
      items: cart!.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        brand: item.brand,
        amount: item.amount,
        price: { amount: item.price.amount, currency: item.price.currency },
        image: { url: item.image.url },
      })),
      shippingAddress: '101 Pine',
      type: enums.OrderType.members.Pickup,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await clearCart(ctx.db, userId);

    const fetchedOrder = await getOrderById(ctx.db, order.id);
    expect(fetchedOrder).not.toBeNull();
    expect(fetchedOrder!.items).toHaveLength(1);
    expect(fetchedOrder!.items[0]).toMatchObject({ name: 'Shirt' });
  });
});

describe('API flow: order status progression', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const ctx = setupTestDb('api_flows_order_status');

  it('order with user relation includes user data after status update', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Frank',
      email: 'f@test.com',
      address: {
        streetAndNumber: '300 Maple',
        city: 'Springfield',
        postalCode: '62701',
        country: 'US',
      },
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [ITEM_A],
      shippingAddress: '300 Maple',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await updateOrderStatus(ctx.db, order.id, {
      status: 'shipped',
      timestamp: new Date(),
    });

    const withUser = await getOrderWithUser(ctx.db, order.id);
    expect(withUser).not.toBeNull();
    expect(withUser!.user).toMatchObject({ name: 'Frank', email: 'f@test.com' });
    expect(withUser!.statusHistory).toHaveLength(2);
  });
});

describe('API flow: duplicate cart add behavior', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const ctx = setupTestDb('api_flows_cart_duplicate');

  it('adding same product twice creates two separate line items', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Grace',
      email: 'g@test.com',
      address: null,
    });
    const userId = user.id;

    await addToCart(ctx.db, userId, ITEM_A);
    await addToCart(ctx.db, userId, ITEM_A);

    const cart = await getCartByUserId(ctx.db, userId);
    expect(cart!.items).toHaveLength(2);
    expect(cart!.items[0]!.productId).toBe('prod-1');
    expect(cart!.items[1]!.productId).toBe('prod-1');
  });
});
