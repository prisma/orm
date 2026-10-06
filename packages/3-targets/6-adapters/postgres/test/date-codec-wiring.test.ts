import { describe, expect, it } from 'vitest';
import * as columnTypes from '../src/exports/column-types';

const codecId = 'pg/timestamptz-date@1';

describe('Postgres Date adapter wiring', () => {
  it('exports the Date column descriptor', () => {
    expect(columnTypes).not.toHaveProperty('timestamptzDateColumn');
    expect(columnTypes).toHaveProperty('timestamptzJsDateColumn', {
      codecId,
    });
  });
});
