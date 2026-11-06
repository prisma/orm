import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createOrder, getOrderById, updateOrderStatus } from '../src/data/orders';
import { enums } from '../src/enums';
import { setupTestDb } from './setup';

describe('array update operators', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const ctx = setupTestDb('update_operators_test');

  it('$push adds status entry to order statusHistory', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Carol',
      email: 'carol@example.com',
      address: null,
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [
        {
          productId: 'prod-1',
          name: 'Item',
          brand: 'B',
          amount: 1,
          price: { amount: 100, currency: 'USD' },
          image: { url: '/item.jpg' },
        },
      ],
      shippingAddress: '123 St',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-03-01T10:00:00Z') }],
    });

    await updateOrderStatus(ctx.db, order.id, {
      status: 'shipped',
      timestamp: new Date('2026-03-02T14:00:00Z'),
    });

    await updateOrderStatus(ctx.db, order.id, {
      status: 'delivered',
      timestamp: new Date('2026-03-04T09:00:00Z'),
    });

    const updated = await getOrderById(ctx.db, order.id);
    expect(updated).not.toBeNull();
    expect(updated!.statusHistory).toHaveLength(3);
    const statuses = updated!.statusHistory.map((s) => s.status);
    expect(statuses).toEqual(['placed', 'shipped', 'delivered']);
  });
});
