import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat } from '../fixtures';

describe('printPsl — nullable list columns', () => {
  it('a nullable text[] column prints String[]? next to a NOT NULL text[] printing String[]', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            labels: { name: 'labels', nativeType: 'text', nullable: true, many: true },
            tags: { name: 'tags', nativeType: 'text', nullable: false, many: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const psl = printPslFromFlat(schemaIR);
    expect(psl).toMatch(/^\s*labels\s+String\[\]\?(\s|$)/m);
    expect(psl).toMatch(/^\s*tags\s+String\[\](\s|$)/m);
    expect(psl).not.toMatch(/tags\s+String\[\]\?/);
  });
});
