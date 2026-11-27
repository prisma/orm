import { charColumn } from '@internal/adapter-postgres/column-types';
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
    User: model('User', {
      fields: {
        id: field.column(charColumn(36)).id().onCreate(gen.uuid(7)),
      },
    }).sql({ table: 'user' }),
  },
});
