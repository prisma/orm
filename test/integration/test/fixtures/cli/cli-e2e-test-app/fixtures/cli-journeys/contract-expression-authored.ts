import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, sql } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        archivedAt: field.column(textColumn).column('archived_at').optional(),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'user',
      indexes: [
        constraints.index({
          expression: sql`eql_v3.eq_term(email)`,
          name: 'users_email_eq',
          type: 'btree',
          options: {},
        }),
        constraints.index([cols.email], {
          where: sql`(archived_at IS NULL)`,
          name: 'users_email_active',
        }),
        constraints.index({
          expression: sql`lower(email)`,
          unique: true,
          name: 'users_email_lower_key',
        }),
        constraints.index([cols.email], { type: 'hash', options: {}, name: 'users_email_hash' }),
      ],
    })),
  },
});
