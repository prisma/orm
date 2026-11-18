import { int4Column } from '@internal/adapter-postgres/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { autoincrement, defineContract, field, model } from '@internal/postgres/contract-builder';

const Embedding1536 = field.column({
  codecId: 'pg/vector@1',
  typeParams: { length: 1536 },
} as const);

export const contract = defineContract({
  extensions: { pgvector },
  models: {
    Document: model('Document', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        embedding: Embedding1536,
      },
    }).sql({ table: 'document' }),
  },
});
