import { defineContract } from '@prisma/orm-postgres/contract-builder';

/**
 * Minimal contract: a single `Note` table with a single `id` column.
 *
 * We use the no-emit pattern — passing the TypeScript-authored contract
 * directly into the runtime — so the example does not require a build
 * step to generate `contract.json` / `contract.d.ts`.
 */
export const contract = defineContract({}, ({ field, model, gen, type }) => ({
  models: {
    Note: model('Note', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid(7)),
      },
    }),
  },
}));
