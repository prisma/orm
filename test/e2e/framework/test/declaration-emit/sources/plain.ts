import { defineContract, rel } from '@prisma/orm-postgres/contract-builder';

export const plain = defineContract({}, ({ field, model, gen, type }) => {
  const User = model('User', {
    fields: {
      id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
      email: field.column(type.String()),
    },
  });
  const Post = model('Post', {
    fields: {
      id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
      userId: field.column(type.Char(36)),
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
