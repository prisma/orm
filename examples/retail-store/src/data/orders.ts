import type { OrderLineItemInput, StatusEntryInput } from '../contract';
import type { Db } from '../db';

export function getUserOrders(db: Db, userId: string) {
  return db.orm.orders.where({ userId }).all();
}

export function getOrderById(db: Db, id: string) {
  return db.orm.orders.where({ id }).first();
}

export function getOrderWithUser(db: Db, id: string) {
  return db.orm.orders.include('user').where({ id }).first();
}

export function createOrder(
  db: Db,
  order: {
    userId: string;
    items: ReadonlyArray<OrderLineItemInput>;
    shippingAddress: string;
    type: Db['enums']['OrderType']['Value'];
    statusHistory: ReadonlyArray<StatusEntryInput>;
  },
) {
  return db.orm.orders.create({
    userId: order.userId,
    items: [...order.items],
    shippingAddress: order.shippingAddress,
    type: order.type,
    statusHistory: [...order.statusHistory],
  });
}

export function deleteOrder(db: Db, id: string) {
  return db.orm.orders.where({ id }).delete();
}

export function updateOrderStatus(db: Db, orderId: string, entry: StatusEntryInput) {
  return db.orm.orders.where({ id: orderId }).update((u) => [u.statusHistory.push(entry)]);
}
