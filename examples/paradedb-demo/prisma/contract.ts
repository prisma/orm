import paradedb from '@prisma/orm-extension-paradedb/pack';
import { int4Column, textColumn } from '@prisma/orm-postgres/adapter/column-types';
import { defineContract, postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract(
  { requiredCapabilities: [...postgres18, ...postgresDriver], extensions: { paradedb } },
  ({ field, model }) => {
    const Item = model('Item', {
      fields: {
        id: field.column(int4Column).id(),
        description: field.column(textColumn),
        category: field.column(textColumn),
        rating: field.column(int4Column),
      },
    });

    return {
      models: {
        Item: Item.sql(({ cols, constraints }) => ({
          table: 'item',
          indexes: [
            constraints.index([cols.id, cols.description, cols.category, cols.rating], {
              type: 'bm25',
              options: { key_field: 'id' },
              name: 'item_bm25_idx',
            }),
          ],
        })),
      },
    };
  },
);
