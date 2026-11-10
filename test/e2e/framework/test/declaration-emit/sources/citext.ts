import { defineContract } from '@prisma/orm-postgres/contract-builder';
import { citext } from '@prisma/orm-postgres-contrib/citext/column-types';
import citextPack from '@prisma/orm-postgres-contrib/citext/pack';

export const contract = defineContract(
  { extensions: { citext: citextPack } },
  ({ field, model, type }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.column(type.Int()).id(),
          email: field.column(citext()),
          handle: field.column(type.citext.Citext()).optional(),
        },
      }).sql({ table: 'user' }),
    },
  }),
);
