import { describe, expect, it } from 'vitest';
import {
  schemaBlockingObjects,
  schemaContentsMeta,
  schemaContentsOf,
  schemaObjectsSummary,
} from '../../src/core/migrations/schema-contents';

describe('schema contents', () => {
  it('reads the schema back from a step it marks', () => {
    expect(
      schemaContentsOf({
        description: 'check',
        sql: 'select 1',
        meta: schemaContentsMeta('billing'),
      }),
    ).toBe('billing');
    expect(schemaContentsOf({ description: 'check', sql: 'select 1' })).toBeUndefined();
  });

  it('names ten objects and counts the rest, each as the advice names it', () => {
    const objects = schemaBlockingObjects(
      'billing',
      Array.from({ length: 12 }, (_, i) => ({ kind: 'table', name: `t${i}` })),
    );

    expect(schemaObjectsSummary('billing', objects)).toBe(
      'Schema "billing" still holds table billing.t0, table billing.t1, table billing.t2, table billing.t3, table billing.t4, table billing.t5, table billing.t6, table billing.t7, table billing.t8, table billing.t9 and 2 more, so it cannot be dropped.',
    );
  });

  it('quotes a name only where Postgres would', () => {
    expect(schemaBlockingObjects('BillingOps', [{ kind: 'view', name: 'paid' }])).toEqual([
      { kind: 'view', name: '"BillingOps".paid' },
    ]);
  });
});
