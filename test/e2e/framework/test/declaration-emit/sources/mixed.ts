import paradedb from '@prisma/orm-extension-paradedb/pack';
import pgvector from '@prisma/orm-extension-pgvector/pack';
import postgis from '@prisma/orm-extension-postgis/pack';
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const mixed = defineContract(
  { extensions: { pgvector, postgis, paradedb } },
  ({ field, model, gen, type }) => {
    const Item = model('Item', {
      fields: { id: field.column(type.Char(36)).id().onCreate(gen.uuid()) },
    });
    return { models: { Item: Item.sql({ table: 'item' }) } };
  },
);
