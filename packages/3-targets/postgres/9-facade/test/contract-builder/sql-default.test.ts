import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, sql } from '../../src/exports/contract-builder';

describe('postgres contract builder defaults', () => {
  it('lowers .default(sql`gen_random_uuid()`) through defineContract', () => {
    const contract = defineContract({
      models: {
        T: model('T', {
          fields: { id: field.column(textColumn).default(sql`gen_random_uuid()`).id() },
        }),
      },
    });
    expect(
      contract.storage.namespaces['public']?.entries.table?.['T']?.columns['id']?.default,
    ).toEqual({ kind: 'function', expression: 'gen_random_uuid()' });
  });
});
