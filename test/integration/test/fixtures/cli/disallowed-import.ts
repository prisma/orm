import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { int4Column, textColumn } from '@repo/test-utils/column-descriptors';
// @ts-expect-error - This import is intentionally disallowed for testing
// biome-ignore lint/correctness/noUnusedImports: Intentionally unused for testing disallowed imports
import { something } from 'some-other-package';

export const contract = defineContract({
  databaseVersion: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});
