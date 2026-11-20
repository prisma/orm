import type { Collection } from '@internal/sql-orm-client';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/decimal-sqlite/generated/contract';

declare const invoices: Collection<Contract, 'Invoice'>;

describe('a SQLite Decimal field', () => {
  test('reads as a string, and a BigIntNumber field as a number', () => {
    const rows = invoices.select('total', 'rebate', 'visits').all();
    type Row = Awaited<typeof rows>[number];
    expectTypeOf<Row['total']>().toEqualTypeOf<string>();
    expectTypeOf<Row['rebate']>().toEqualTypeOf<string | null>();
    expectTypeOf<Row['visits']>().toEqualTypeOf<number>();
  });

  test('offers equality filters only', () => {
    invoices.where((invoice) => invoice.total.eq('12.50'));
    invoices.where((invoice) => invoice.total.neq('12.50'));
    // @ts-expect-error text compares by its characters, so a Decimal is not ordered
    invoices.where((invoice) => invoice.total.gt('12.50'));
    // @ts-expect-error text compares by its characters, so a Decimal is not ordered
    invoices.orderBy((invoice) => invoice.total.asc());
    // @ts-expect-error a Decimal is a number written as text, so it offers no text filter
    invoices.where((invoice) => invoice.total.like('12%'));
  });

  test('offers no aggregate over its values', () => {
    invoices.aggregate((agg) => ({
      // @ts-expect-error a Decimal offers no sum
      total: agg.sum('total'),
    }));
    invoices.aggregate((agg) => ({
      // @ts-expect-error a Decimal offers no average
      mean: agg.avg('total'),
    }));
    invoices.aggregate((agg) => ({
      // @ts-expect-error a Decimal is not ordered, so it has no greatest value
      greatest: agg.max('total'),
    }));
  });
});
