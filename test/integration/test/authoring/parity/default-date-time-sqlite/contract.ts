import { integerColumn } from '@internal/adapter-sqlite/column-types';
import { defineContract } from '@internal/sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    T: model('T', {
      fields: {
        id: field.column(integerColumn).id(),
        instant: field.temporal.datetime().default(new Date('2024-01-01T00:00:00.500Z')),
      },
    }).sql({ table: 't' }),
  },
}));
