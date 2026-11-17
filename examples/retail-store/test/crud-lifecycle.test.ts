import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { getCartByUserId, upsertCart } from '../src/data/carts';
import { createInvoice, findInvoiceById } from '../src/data/invoices';
import { findLocations } from '../src/data/locations';
import { createOrder, deleteOrder, getOrderById, getUserOrders } from '../src/data/orders';
import { findProductById, findProducts } from '../src/data/products';
import { findUserById, findUsers } from '../src/data/users';
import { enums } from '../src/enums';
import { setupTestDb } from './setup';

describe('CRUD lifecycle', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const ctx = setupTestDb('crud_lifecycle_test');

  it('creates and reads products with embedded Price and Image', async () => {
    const product = await ctx.db.orm.products.create({
      name: 'Test Shirt',
      brand: 'TestBrand',
      code: 'TB-001',
      description: 'A test shirt',
      primaryCategory: 'Apparel',
      subCategory: 'Topwear',
      articleType: 'Shirts',
      price: { amount: 49.99, currency: 'USD' },
      image: { url: '/test.jpg' },
      embedding: null,
      status: 'active',
    });

    expect(product.id).toBeDefined();
    expect(product.price).toEqual({ amount: 49.99, currency: 'USD' });
    expect(product.image).toEqual({ url: '/test.jpg' });

    const all = await findProducts(ctx.db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: 'Test Shirt', brand: 'TestBrand' });

    const found = await findProductById(ctx.db, product.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test Shirt');
  });

  it('creates and reads users with embedded Address', async () => {
    const address = {
      streetAndNumber: '123 Test St',
      city: 'TestCity',
      postalCode: '12345',
      country: 'US',
    };
    const user = await ctx.db.orm.users.create({
      name: 'Test User',
      email: 'test@example.com',
      address,
    });

    expect(user.address).toEqual(address);

    const found = await findUserById(ctx.db, user.id);
    expect(found).not.toBeNull();
    expect(found!.address).toEqual(address);
  });

  it('creates user with null address', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'No Address',
      email: 'noaddr@example.com',
      address: null,
    });

    expect(user.address).toBeNull();
    const all = await findUsers(ctx.db);
    expect(all).toHaveLength(1);
    expect(all[0]!.address).toBeNull();
  });

  it('creates and reads locations', async () => {
    await ctx.db.orm.locations.createAll([
      {
        name: 'Store A',
        streetAndNumber: '1 Main St',
        city: 'CityA',
        postalCode: '11111',
        country: 'US',
      },
      {
        name: 'Store B',
        streetAndNumber: '2 Oak Ave',
        city: 'CityB',
        postalCode: '22222',
        country: 'US',
      },
    ]);

    const locations = await findLocations(ctx.db);
    expect(locations).toHaveLength(2);
    const names = locations.map((l) => l.name).sort();
    expect(names).toEqual(['Store A', 'Store B']);
  });

  it('creates order with embedded line items and status history, then deletes', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Buyer',
      email: 'buyer@example.com',
      address: null,
    });

    const order = await createOrder(ctx.db, {
      userId: user.id,
      items: [
        {
          productId: 'prod-1',
          name: 'Item 1',
          brand: 'Brand1',
          amount: 2,
          price: { amount: 29.99, currency: 'USD' },
          image: { url: '/item1.jpg' },
        },
      ],
      shippingAddress: '456 Test Ave',
      type: enums.OrderType.members.Delivery,
      statusHistory: [{ status: 'placed', timestamp: new Date('2026-01-01') }],
    });

    expect(order.id).toBeDefined();
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ name: 'Item 1', amount: 2 });
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ status: 'placed' });

    const userOrders = await getUserOrders(ctx.db, user.id);
    expect(userOrders).toHaveLength(1);

    const found = await getOrderById(ctx.db, order.id);
    expect(found).not.toBeNull();
    expect(found!.shippingAddress).toBe('456 Test Ave');

    const deleted = await deleteOrder(ctx.db, order.id);
    expect(deleted).not.toBeNull();

    const afterDelete = await getUserOrders(ctx.db, user.id);
    expect(afterDelete).toHaveLength(0);
  });

  it('upserts cart (insert and update paths)', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'Shopper',
      email: 'shopper@example.com',
      address: null,
    });

    const item = {
      productId: 'prod-1',
      name: 'Widget',
      brand: 'Acme',
      amount: 1,
      price: { amount: 9.99, currency: 'USD' },
      image: { url: '/widget.jpg' },
    };

    await upsertCart(ctx.db, user.id, [item]);
    const cart = await getCartByUserId(ctx.db, user.id);
    expect(cart).not.toBeNull();
    expect(cart!.items).toHaveLength(1);
    expect(cart!.items[0]).toMatchObject({ name: 'Widget' });

    const updatedItem = { ...item, amount: 3 };
    await upsertCart(ctx.db, user.id, [updatedItem]);
    const updatedCart = await getCartByUserId(ctx.db, user.id);
    expect(updatedCart).not.toBeNull();
    expect(updatedCart!.items).toHaveLength(1);
    expect(updatedCart!.items[0]!.amount).toBe(3);
  });

  it('creates invoice with embedded line items', async () => {
    const user = await ctx.db.orm.users.create({
      name: 'InvUser',
      email: 'inv@example.com',
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

    expect(invoice.id).toBeDefined();
    expect(invoice.items).toHaveLength(1);
    expect(invoice.total).toBe(108.5);

    const found = await findInvoiceById(ctx.db, invoice.id);
    expect(found).not.toBeNull();
    expect(found!.items[0]).toMatchObject({ name: 'Item', unitPrice: 100 });
  });
});
