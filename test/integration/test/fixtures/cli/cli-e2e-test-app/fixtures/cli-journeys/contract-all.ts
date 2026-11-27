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
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        phone: field.column(textColumn).optional(),
        bio: field.column(textColumn).optional(),
        avatarUrl: field.column(textColumn).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
