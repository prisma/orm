import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
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
  namespaces: ['auth'],
  models: {
    AuthSessions: model('AuthSessions', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).id(),
        user_id: field.column(textColumn),
      },
    }).sql({ table: 'sessions', control: 'managed' }),
  },
});
