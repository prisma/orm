import { int4Column, timeTemporalColumn } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  gen,
  model,
  postgres18,
  postgresDriver,
} from '@internal/postgres/contract-builder';

export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(int4Column).id(),
        seenAt: field.column(timeTemporalColumn(3)).onUpdate(gen.now()),
      },
    }).sql({ table: 'event' }),
  },
});
