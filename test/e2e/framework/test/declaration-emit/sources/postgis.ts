import { geometry } from '@prisma/orm-extension-postgis/column-types';
import postgis from '@prisma/orm-extension-postgis/pack';
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const geo = defineContract({ extensions: { postgis } }, ({ field, model, gen, type }) => {
  const Place = model('Place', {
    fields: {
      id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
      loc: field.column(geometry({ srid: 4326 })),
    },
  });
  return { models: { Place: Place.sql({ table: 'place' }) } };
});
