import {
  jsonbColumn,
  textColumn,
  timestamptzTemporalColumn,
  varcharColumn,
} from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@internal/postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const enums = {
  AccountStatus: enumType(
    'AccountStatus',
    pgText,
    member('ACTIVE'),
    member('INVITED'),
    member('SUSPENDED'),
  ),
  ProjectVisibility: enumType(
    'ProjectVisibility',
    pgText,
    member('PRIVATE'),
    member('TEAM'),
    member('PUBLIC'),
  ),
} as const;

const Account = model('Account', {
  fields: {
    id: field
      .generated({
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .id(),
    email: field.column(varcharColumn(320)).unique(),
    status: field.namedType(enums.AccountStatus),
    profile: field.column(jsonbColumn).optional(),
    createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()'),
  },
}).sql({ table: 'account' });

const Project = model('Project', {
  fields: {
    id: field
      .generated({
        type: textColumn,
        generated: { kind: 'generator', id: 'ulid' },
      })
      .id(),
    accountId: field.column(textColumn),
    name: field.column(textColumn),
    slug: field.column(varcharColumn(128)).optional(),
    visibility: field.namedType(enums.ProjectVisibility),
    metadata: field.column(jsonbColumn).optional(),
    createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'project',
  indexes: [constraints.index([cols.accountId])],
  foreignKeys: [constraints.foreignKey(cols.accountId, Account.refs.id)],
}));

export const contract = defineContract({
  enums,
  models: {
    Account,
    Project,
  },
});
