import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { int4Column, textColumn } from '@repo/test-utils/column-descriptors';

const contractObj = defineContract({
  databaseVersion: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '0.0.1',
    },
    pg: {},
  },
};
