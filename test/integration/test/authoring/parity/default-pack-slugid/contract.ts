import { textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, postgres18, postgresDriver } from '@internal/postgres/contract-builder';
import { slugidDefaultsPack } from './packs';

export const contract = defineContract(
  {
    requiredCapabilities: [...postgres18, ...postgresDriver],
    extensions: { 'slugid-defaults': slugidDefaultsPack },
  },
  ({ field, gen, model }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.column(textColumn).id().onCreate(gen.slugid()),
        },
      }).sql({ table: 'user' }),
    },
  }),
);
