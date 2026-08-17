import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    bio: field.column(textColumn).optional(),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).defaultSql('autoincrement()').id(),
    authorId: field.column(int4Column),
    title: field.column(textColumn),
    publishedAt: field.column(timestamptzTemporalColumn).optional(),
  },
  relations: {
    author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }).sql({ fk: {} }),
  },
}).sql({ table: 'posts' });

const User = UserBase.relations({
  posts: rel.hasMany(Post, { by: 'authorId' }),
}).sql({ table: 'users' });

export const contract = defineContract({
  models: {
    User,
    Post,
  },
});
