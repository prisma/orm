import { describe, expect, it } from 'vitest';
import {
  intervalPartsColumn,
  intervalStringColumn,
  timestampInstantColumn,
  timestampJsDateColumn,
} from '../src/exports/column-types';

describe('the explicit timestamp and interval column helpers', () => {
  it('name the codec of each explicit type', () => {
    expect({
      timestampJsDate: timestampJsDateColumn,
      timestampInstant: timestampInstantColumn,
      intervalParts: intervalPartsColumn(),
      intervalString: intervalStringColumn(),
    }).toEqual({
      timestampJsDate: { codecId: 'pg/timestamp-date@1' },
      timestampInstant: { codecId: 'pg/timestamp-instant@1' },
      intervalParts: { codecId: 'pg/interval@1' },
      intervalString: { codecId: 'pg/interval-string@1' },
    });
  });

  it('carry an interval precision when one is given', () => {
    expect(intervalStringColumn(3)).toEqual({
      codecId: 'pg/interval-string@1',
      typeParams: { precision: 3 },
    });
  });
});
