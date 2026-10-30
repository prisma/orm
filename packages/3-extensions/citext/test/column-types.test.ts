import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { citext, citextColumn } from '../src/exports/column-types';
import citextPack from '../src/exports/pack';

describe('citext column type', () => {
  it('describes a pg/citext@1 column', () => {
    expect(citext()).toEqual({ codecId: 'pg/citext@1' });
  });

  it('describes a pg/citext@1 column through the codec column helper', () => {
    expect(citextColumn()).toMatchObject({ codecId: 'pg/citext@1' });
  });

  it('builds a column of the citext/citext data type', () => {
    const contract = defineContract(
      { extensions: { citext: citextPack } },
      ({ field, model, type }) => ({
        models: {
          User: model('User', {
            fields: { id: field.column(type.Int()).id(), email: field.column(citext()) },
          }).sql({ table: 'user' }),
        },
      }),
    );

    const [namespace] = Object.values(contract.storage.namespaces);
    expect(namespace?.entries.table?.['user']?.columns['email']).toMatchObject({
      dataType: 'citext/citext',
      codecId: 'pg/citext@1',
    });
  });
});
