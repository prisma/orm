import {
  boolColumn,
  float8Column,
  int4Column,
  jsonbColumn,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@internal/postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const types = {
  Email: {
    kind: 'codec-instance',
    codecId: 'pg/text@1',
    nativeType: 'text',
    typeParams: {},
  },
} as const;

const enums = {
  Role: enumType('Role', pgText, member('USER', 'USER'), member('ADMIN', 'ADMIN')),
} as const;

const User = model('User', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    email: field.namedType(types.Email).unique(),
    role: field.namedType(enums.Role),
    createdAt: field.column(timestamptzTemporalColumn).defaultSql('now()'),
    isActive: field.column(boolColumn).default(true),
    profile: field.column(jsonbColumn).optional(),
  },
}).sql({ table: 'user' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    userId: field.column(int4Column),
    title: field.column(textColumn),
    rating: field.column(float8Column).optional(),
  },
})
  .attributes(({ fields, constraints }) => ({
    uniques: [constraints.unique([fields.title, fields.userId])],
  }))
  .sql(({ cols, constraints }) => ({
    table: 'post',
    indexes: [constraints.index([cols.userId])],
    foreignKeys: [
      constraints.foreignKey(cols.userId, User.refs.id, {
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
    ],
  }));

export const contract = defineContract({
  types,
  enums,
  models: {
    User,
    Post,
  },
});
