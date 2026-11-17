import { describe, expect, it } from 'vitest';
import { postgresDataTypes } from '../../src/core/data-types';
import { autoincrementWidthOfPseudoType } from '../../src/core/migrations/autoincrement-widths';
import { columnTypeCheckIfReadable } from '../../src/core/migrations/planner-sql-checks';

describe('the SERIAL pseudo-types an autoincrement() column is written with', () => {
  it('read as the integer type Postgres stores, in any case and with the numbered aliases', () => {
    expect(
      ['SMALLSERIAL', 'serial', 'BigSerial', 'serial2', 'SERIAL4', 'serial8', 'int4'].map(
        (type) => autoincrementWidthOfPseudoType(type)?.sequenceType,
      ),
    ).toEqual(['smallint', 'integer', 'bigint', 'smallint', 'integer', 'bigint', undefined]);
  });

  it('give the add-column type check the catalog text of that integer type', () => {
    expect(
      ['SMALLSERIAL', 'SERIAL', 'BIGSERIAL'].map((type) =>
        columnTypeCheckIfReadable(type, postgresDataTypes),
      ),
    ).toEqual(['smallint', 'integer', 'bigint'].map((text) => ({ kind: 'catalog-text', text })));
  });
});
