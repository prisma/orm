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

const ITEM = {
  productId: 'prod-1',
  name: 'Shirt',
  brand: 'Heritage',
  amount: 2,
  price: { amount: 79.99, currency: 'USD' },
  image: { url: '/shirt.jpg' },
};

describe('order lifecycle (integration)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const ctx = setupTestDb('order_lifecycle_test');

  it('creates an order from cart items and clears the cart', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      address: null,
    });

    await addToCart(ctx.db, user.id, ITEM);
    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart!.items).toHaveLength(1);

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: cart!.items,
      shippingAddress: '123 Main St',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
    });

    expect(order.id).toBeDefined();
    expect(order.items).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ status: 'placed' });

    await clearCart(ctx.db, user.id);
    const clearedCart = await getCartByUserId(ctx.db, user.id);
    expect(clearedCart!.items).toHaveLength(0);
  });

  it('tracks order status through placed → shipped → delivered', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Bob',
      email: 'bob@example.com',
      address: null,
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [ITEM],
      shippingAddress: '456 Oak Ave',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
    });

    const shipped = await updateOrderStatus(ctx.db, order.id, {
      status: 'shipped',
      timestamp: new Date('2026-03-02T14:00:00Z'),
    });
    expect(shipped).not.toBeNull();
    expect(shipped!['statusHistory']).toHaveLength(2);

    const delivered = await updateOrderStatus(ctx.db, order.id, {
      status: 'delivered',
      timestamp: new Date('2026-03-04T09:00:00Z'),
    });
    expect(delivered).not.toBeNull();
    expect(delivered!['statusHistory']).toHaveLength(3);

    const statuses = (delivered!['statusHistory'] as ReadonlyArray<{ status: string }>).map(
      (s) => s.status,
    );
    expect(statuses).toEqual(['placed', 'shipped', 'delivered']);
  });

  it('updateOrderStatus returns null for non-existent order', async () => {
    const result = await updateOrderStatus(ctx.db, '000000000000000000000000', {
      status: 'shipped',
      timestamp: new Date(),
    });
    expect(result).toBeNull();
  });

  it('retrieves order with user relation', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Carol',
      email: 'carol@example.com',
      address: { streetAndNumber: '789 Elm', city: 'TestCity', postalCode: '12345', country: 'US' },
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [ITEM],
      shippingAddress: '789 Elm',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const withUser = await getOrderWithUser(ctx.db, order.id);
    expect(withUser).not.toBeNull();
    expect(withUser!.user).toMatchObject({ name: 'Carol', email: 'carol@example.com' });
  });

  it('getUserOrders returns all orders for a user', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Dave',
      email: 'dave@example.com',
      address: null,
    });

    await createOrder(ctx.db, {
      userId: user.id,
      items: [ITEM],
      shippingAddress: 'Addr 1',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });
    await createOrder(ctx.db, {
      userId: user.id,
      items: [{ ...ITEM, productId: 'prod-2', name: 'Chinos' }],
      shippingAddress: 'Addr 2',
      type: enums.OrderType.members.Pickup,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const orders = await getUserOrders(ctx.db, user.id);
    expect(orders).toHaveLength(2);
  });

  it('deleteOrder removes the order', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Eve',
      email: 'eve@example.com',
      address: null,
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [ITEM],
      shippingAddress: '101 Pine',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    await deleteOrder(ctx.db, order.id);
    const found = await getOrderById(ctx.db, order.id);
    expect(found).toBeNull();
  });
});
