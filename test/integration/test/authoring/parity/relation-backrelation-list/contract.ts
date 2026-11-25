import { int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
  },
  relations: {
    user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({
      fk: { onDelete: 'cascade', onUpdate: 'cascade' },
    }),
  },
}).sql({ table: 'post' });

const User = UserBase.relations({
  posts: rel.hasMany(() => Post, { by: 'userId' }),
}).sql({ table: 'user' });

export const contract = defineContract({
  databaseVersion: 18,
  models: {
    User,
    Post,
  },
});
