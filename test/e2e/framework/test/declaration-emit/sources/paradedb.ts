import paradedb from '@prisma/orm-extension-paradedb/pack';
import { int4Column, textColumn } from '@prisma/orm-postgres/adapter/column-types';
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const pdb = defineContract({ extensions: { paradedb } }, ({ field, model }) => {
  const Item = model('Item', {
    fields: { id: field.column(int4Column).id(), description: field.column(textColumn) },
  });
  return { models: { Item: Item.sql({ table: 'item' }) } };
});
