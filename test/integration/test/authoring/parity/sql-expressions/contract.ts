import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import {
  check,
  defineContract,
  field,
  fullTextIndex,
  model,
  policyUpdate,
  rlsEnabled,
  role,
  sql,
} from '@internal/postgres/contract-builder';

const authenticated = role('authenticated');

const owner = sql`"userId"::uuid = auth.uid()`;

const liveRows = sql`
  "archivedAt" IS NULL -- live rows only
  AND "userId" <> ''
`;

const ownerOrAdmin = sql`
  "userId"::uuid = auth.uid()
    OR auth.role() = 'admin'
`;

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(textColumn),
    title: field.column(textColumn),
    email: field.column(textColumn),
    body: field.column(textColumn),
    archivedAt: field.column(timestamptzTemporalColumn).optional(),
    slug: field.column(textColumn).default(sql`
      lower(
        'post-' || md5(random()::text)
      )
    `),
  },
}).sql(({ cols, constraints }) => ({
  table: 'post',
  indexes: [
    constraints.index([cols.userId], {
      name: 'post_user_active',
      where: sql`
        "archivedAt" IS NULL
          AND "userId" <> ''
      `,
    }),
    constraints.index([cols.email], {
      name: 'post_email_live',
      where: sql`
        ${liveRows}
          AND "email" <> ''
      `,
    }),
    constraints.index({ expression: sql`lower("email")`, name: 'post_email_lower' }),
    fullTextIndex([[cols.title, cols.email], cols.body], {
      name: 'post_body_search',
      where: sql`
        "archivedAt" IS NULL
          AND "body" <> ''
      `,
    }),
  ],
  checks: [
    check({ expression: sql`"email" !~ '\s'`, name: 'post_email_no_space' }),
    check({ expression: sql`"email" <> 'x\`y'`, name: 'post_email_not_backtick' }),
    check({
      expression: sql`
		"id" > 0
			AND "id" < 1000000
	`,
      name: 'post_id_range',
    }),
  ],
}));

export const contract = defineContract({
  models: { Post },
  entities: [
    rlsEnabled(Post),
    policyUpdate(Post, {
      name: 'post_owner_write',
      roles: [authenticated],
      using: owner,
      withCheck: sql`${owner} AND "archivedAt" IS NULL`,
    }),
    policyUpdate(Post, {
      name: 'post_admin_write',
      roles: [authenticated],
      using: ownerOrAdmin,
      withCheck: sql`
        (
          ${ownerOrAdmin}
        )
        AND "archivedAt" IS NULL
      `,
    }),
  ],
});
