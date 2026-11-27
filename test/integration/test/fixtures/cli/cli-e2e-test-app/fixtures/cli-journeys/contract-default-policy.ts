import { int4Column } from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  field,
  model,
  postgres18,
  postgresDriver,
} from '@internal/postgres/contract-builder';

export const contract = defineContract({
  requiredCapabilities: [...postgres18, ...postgresDriver],
  defaultControlPolicy: 'external',
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' }),
  },
});
