import { integerNumberColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import { defineContract } from '@internal/sqlite/contract-builder';
import { SQLITE_BIGINT_NUMBER_CODEC_ID } from '@internal/target-sqlite/codec-ids';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Invoice: model('Invoice', {
      fields: {
        id: field.column(integerNumberColumn).id(),
        total: field.column(textColumn),
        visits: field.column({ codecId: SQLITE_BIGINT_NUMBER_CODEC_ID }),
      },
    }).sql({ table: 'invoice' }),
  },
}));
