import { textColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, rel } from '@prisma/orm-sqlite/contract-builder';

export const lite = defineContract({}, ({ field, model, gen, type }) => {
  const User = model('User', {
    fields: {
      id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
      email: field.column(textColumn),
    },
  });
  const Post = model('Post', {
    fields: {
      id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
      userId: field.column(type.sql.Char(36)),
    },
  });
  return {
    models: {
      User: User.relations({ posts: rel.hasMany(Post, { by: 'userId' }) }).sql({ table: 'user' }),
      Post: Post.relations({ user: rel.belongsTo(User, { from: 'userId', to: 'id' }) }).sql({
        table: 'post',
      }),
    },
  };
});
