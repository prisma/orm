import { int4Column } from '@internal/adapter-postgres/column-types';
import {
  autoincrement,
  defineContract,
  field,
  model,
  nativeEnum,
  pg,
} from '@internal/postgres/contract-builder';

const Role = nativeEnum('Role', 'user', 'admin');
const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

export const contract = defineContract({
  namespaces: ['auth'],
  models: {
    Account: model('Account', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        role: field.column(pg.enum(Role)),
      },
    }).sql({ table: 'account' }),
    Session: model('Session', {
      namespace: 'auth',
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        aal: field.column(pg.enum(AalLevel)).optional(),
      },
    }).sql({ table: 'session' }),
  },
});
