import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  databaseVersion: 18,
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
