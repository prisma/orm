import { int4Column, timeTemporalColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, gen, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(int4Column).id(),
        seenAt: field.column(timeTemporalColumn(3)).onUpdate(gen.now()),
      },
    }).sql({ table: 'event' }),
  },
});
