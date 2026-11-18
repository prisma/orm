import { describe, expect, it } from 'vitest';
import { dependentsOf, dependentsSummary } from '../../src/core/migrations/dependent-objects';

describe('objects that depend on what an operation removes', () => {
  it('reads each dependent object from the error detail, and skips other lines', () => {
    expect(
      dependentsOf(
        'view billing.v_paid depends on table billing.audit_log\nmaterialized view billing.totals depends on table billing.audit_log\nand 2 other objects (see server log for list)',
      ),
    ).toEqual([
      { kind: 'view', name: 'billing.v_paid' },
      { kind: 'materialized view', name: 'billing.totals' },
    ]);
    expect(dependentsOf(undefined)).toEqual([]);
  });

  it('names the operation by its label when it does not drop a table', () => {
    expect(
      dependentsSummary(
        { schema: 'billing', objectType: 'column', name: 'total', table: 'invoice' },
        'Drop column "total" from "invoice"',
        [
          { kind: 'view', name: 'billing.a' },
          { kind: 'view', name: 'billing.b' },
        ],
      ),
    ).toBe(
      'Drop column "total" from "invoice" cannot run while view billing.a and view billing.b depend on what it changes.',
    );
  });
});
