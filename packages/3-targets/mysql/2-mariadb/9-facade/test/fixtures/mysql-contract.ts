import { defineContract } from '@internal/mysql/contract-builder';

/** A contract written with MySQL's `defineContract`, the import a MariaDB project must not use. */
export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    User: model('User', { fields: { id: field.column(type.Int()).id() } }),
  },
}));
