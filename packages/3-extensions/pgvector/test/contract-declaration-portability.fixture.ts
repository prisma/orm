import pgvector from '@internal/extension-pgvector/pack';
import { defineContract } from '@internal/postgres/contract-builder';

export const pgvectorContract = defineContract(
  { extensions: { pgvector } },
  ({ type, field, model }) => ({
    models: {
      Item: model('Item', {
        fields: {
          id: field.column(type.Int()).id(),
          embedding: field.column(type.pgvector.Vector(3)),
        },
      }).sql({ table: 'item' }),
    },
  }),
);
