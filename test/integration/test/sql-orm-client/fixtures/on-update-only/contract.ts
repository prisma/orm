import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, gen, model } from '@internal/postgres/contract-builder';

const Event = model('Event', {
  fields: {
    id: field.column(int4Column).id(),
    revision: field.column(textColumn).onUpdate(gen.uuid()),
    touchedBy: field.column(textColumn).onCreate(gen.uuid()).onUpdate(gen.uuid()),
  },
}).sql({ table: 'event' });

export const contract = defineContract({
  models: { Event },
});
