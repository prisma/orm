import type { InvoiceLineItemInput } from '../contract';
import type { Db } from '../db';

export function findInvoiceById(db: Db, id: string) {
  return db.orm.invoices.where({ id }).first();
}

export function findInvoiceWithOrder(db: Db, id: string) {
  return db.orm.invoices.include('order').where({ id }).first();
}

export function createInvoice(
  db: Db,
  invoice: {
    orderId: string;
    items: ReadonlyArray<InvoiceLineItemInput>;
    subtotal: number;
    tax: number;
    total: number;
    issuedAt: Date;
  },
) {
  return db.orm.invoices.create({
    orderId: invoice.orderId,
    items: [...invoice.items],
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    issuedAt: invoice.issuedAt,
  });
}
