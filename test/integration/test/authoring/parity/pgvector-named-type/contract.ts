import { int4Column } from '@internal/adapter-postgres/column-types';
import { autoincrement, defineContract, field, model } from '@internal/postgres/contract-builder';

const embedding1536Type = {
  kind: 'codec-instance',
  codecId: 'pg/vector@1',
  nativeType: 'vector',
  typeParams: { length: 1536 },
} as const;

export const contract = defineContract({
  types: {
    Embedding1536: embedding1536Type,
  },
  models: {
    Document: model('Document', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        embedding: field.namedType(embedding1536Type),
      },
    }).sql({ table: 'document' }),
  },
});
