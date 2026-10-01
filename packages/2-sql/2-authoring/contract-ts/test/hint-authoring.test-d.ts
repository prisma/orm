import { describe, expectTypeOf, it } from 'vitest';
import { field, model } from '../src/contract-builder';
import type { TableHint } from '../src/contract-definition';
import { columnDescriptor } from './helpers/column-descriptor';

const fields = { id: field.column(columnDescriptor('pg/int4@1')).id() };

describe('model rename hint types', () => {
  it('accepts a was hint on the sql stage', () => {
    expectTypeOf<{ readonly was: 'Profile' }>().toExtend<TableHint>();
    model('User', { fields }).sql({ hint: { was: 'Profile' } });
  });

  it('rejects the reserved deprecated arm', () => {
    // @ts-expect-error deprecated is reserved and has no arm
    model('User', { fields }).sql({ hint: { deprecated: true } });
    expectTypeOf<{ readonly deprecated: true }>().not.toExtend<TableHint>();
  });

  it('rejects was combined with deleted', () => {
    // @ts-expect-error a renamed table still exists, a deleted one does not
    model('User', { fields }).sql({ hint: { was: 'x', deleted: true } });
    expectTypeOf<{ readonly was: 'x'; readonly deleted: true }>().not.toExtend<TableHint>();
  });
});
