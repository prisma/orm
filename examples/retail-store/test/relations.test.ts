import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { getCartWithUser, upsertCart } from '../src/data/carts';
import { createInvoice, findInvoiceWithOrder } from '../src/data/invoices';
import { createOrder } from '../src/data/orders';
import { enums } from '../src/enums';
import { setupTestDb } from './setup';

describe('relation loading via $lookup', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const ctx = setupTestDb('relations_test');

  it('loads cart with user via include()', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      address: null,
    });

    await upsertCart(ctx.db, user.id, [
      {
        productId: 'prod-1',
        name: 'Widget',
        brand: 'Acme',
        amount: 1,
        price: { amount: 9.99, currency: 'USD' },
        image: { url: '/widget.jpg' },
      },
    ]);

    const cartWithUser = await getCartWithUser(ctx.db, user.id);
    expect(cartWithUser).not.toBeNull();
    expect(cartWithUser!.user).toMatchObject({
      name: 'Alice',
      email: 'alice@example.com',
    });
    expect(cartWithUser!.items).toHaveLength(1);
  });

  it('loads invoice with order via include()', async () => {
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
      shippingAddress: '789 St',
      type: enums.OrderType.members.Pickup,
      statusHistory: [{ status: 'placed', timestamp: new Date() }],
    });

    const invoice = await createInvoice(ctx.db, {
      orderId: order.id,
      items: [{ name: 'Item', amount: 1, unitPrice: 100, lineTotal: 100 }],
      subtotal: 100,
      tax: 8.5,
      total: 108.5,
      issuedAt: new Date('2026-03-15'),
    });

    const invoiceWithOrder = await findInvoiceWithOrder(ctx.db, invoice.id);
    expect(invoiceWithOrder).not.toBeNull();
    expect(invoiceWithOrder!.order).toMatchObject({
      shippingAddress: '789 St',
      type: enums.OrderType.members.Pickup,
    });
  });
});
