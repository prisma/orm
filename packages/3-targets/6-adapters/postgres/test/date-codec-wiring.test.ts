import { describe, expect, it } from 'vitest';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import * as columnTypes from '../src/exports/column-types';

const codecId = 'pg/timestamptz-date@1';

describe('Postgres Date adapter wiring', () => {
  it('exports the Date column descriptor', () => {
    expect(columnTypes).not.toHaveProperty('timestamptzDateColumn');
    expect(columnTypes).toHaveProperty('timestamptzJsDateColumn', {
      codecId,
      nativeType: 'timestamptz',
    });
  });

  it('declares storage for Date columns', () => {
    expect(postgresAdapterDescriptorMeta.types.storage).toContainEqual({
      typeId: codecId,
      familyId: 'sql',
      targetId: 'postgres',
      nativeType: 'timestamptz',
    });
  });
});
