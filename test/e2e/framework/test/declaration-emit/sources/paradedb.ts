import paradedb from '@prisma/orm-extension-paradedb/pack';
import { int4Column, textColumn } from '@prisma/orm-postgres/adapter/column-types';
import { defineContract, postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const pdb = defineContract(
  { requiredCapabilities: [...postgres18, ...postgresDriver], extensions: { paradedb } },
  ({ field, model }) => {
    const Item = model('Item', {
      fields: { id: field.column(int4Column).id(), description: field.column(textColumn) },
    });
    return { models: { Item: Item.sql({ table: 'item' }) } };
  },
);
