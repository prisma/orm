import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import {
  autoincrement,
  defineContract,
  field,
  model,
  now,
  sql,
} from '../../src/exports/contract-builder';

describe('postgres contract builder defaults', () => {
  it('re-exports the family default helpers', () => {
    expect(now()).toEqual({ kind: 'function', expression: 'now()' });
    expect(autoincrement()).toEqual({ kind: 'function', expression: 'autoincrement()' });
  });

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
