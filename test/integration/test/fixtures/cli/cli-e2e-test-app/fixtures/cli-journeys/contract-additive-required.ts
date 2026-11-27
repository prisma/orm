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
        required_name: field.column(textColumn).unique({ name: 'user_required_name_key' }),
      },
    }).sql({ table: 'user' }),
  },
});
