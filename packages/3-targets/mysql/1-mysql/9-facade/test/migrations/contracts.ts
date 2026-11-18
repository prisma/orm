import {
  autoincrement,
  defineContract,
  enumType,
  member,
  rel,
} from '../../src/exports/contract-builder';

/** The example contract with a nullable `nickname` on `User`. */
export function contractWithNickname() {
  const Role = enumType(
    'Role',
    { codecId: 'mysql/enum@1' },
    member('USER', 'USER'),
    member('ADMIN', 'ADMIN'),
  );
  return defineContract({ enums: { Role } }, ({ field, model, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        email: field.column(type.String()).unique(),
        role: field.namedType(Role),
        nickname: field.column(type.String()).optional(),
      },
    });
    const Post = model('Post', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        authorId: field.column(type.Int()),
      },
    });
    return {
      models: {
        User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) }).sql(
          ({ cols, constraints }) => ({
            foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id)],
          }),
        ),
      },
    };
  });
}

const role = () =>
  enumType('Role', { codecId: 'mysql/enum@1' }, member('USER', 'USER'), member('ADMIN', 'ADMIN'));

/** The example contract whose foreign key from `Post` to `User` declares no index, so InnoDB makes one. */
export function contractWithUnindexedForeignKey() {
  const Role = role();
  return defineContract({ enums: { Role } }, ({ field, model, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        email: field.column(type.String()).unique(),
        role: field.namedType(Role),
      },
    });
    const Post = model('Post', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        authorId: field.column(type.Int()),
      },
    });
    return {
      models: {
        User: User.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) }).sql(
          ({ cols, constraints }) => ({
            foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id, { index: false })],
          }),
        ),
      },
    };
  });
}

/** The example contract without the relation: `Post.authorId` stays, with no foreign key. */
export function contractWithoutForeignKey() {
  const Role = role();
  return defineContract({ enums: { Role } }, ({ field, model, type }) => ({
    models: {
      User: model('User', {
        fields: {
          id: field.column(type.Int()).id().default(autoincrement()),
          email: field.column(type.String()).unique(),
          role: field.namedType(Role),
        },
      }),
      Post: model('Post', {
        fields: {
          id: field.column(type.Int()).id().default(autoincrement()),
          title: field.column(type.String()),
          authorId: field.column(type.Int()),
        },
      }),
    },
  }));
}

/** The example contract with an `Admin` model, and `Post.authorId` pointing at `Admin` with no index declared. */
export function contractRepointedToAdmin() {
  const Role = role();
  return defineContract({ enums: { Role } }, ({ field, model, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        email: field.column(type.String()).unique(),
        role: field.namedType(Role),
      },
    });
    const Admin = model('Admin', {
      fields: { id: field.column(type.Int()).id().default(autoincrement()) },
    });
    const Post = model('Post', {
      fields: {
        id: field.column(type.Int()).id().default(autoincrement()),
        title: field.column(type.String()),
        authorId: field.column(type.Int()),
      },
    });
    return {
      models: {
        User,
        Admin: Admin.relations({ posts: rel.hasMany(Post, { by: 'authorId' }) }),
        Post: Post.relations({ author: rel.belongsTo(Admin, { from: 'authorId', to: 'id' }) }).sql(
          ({ cols, constraints }) => ({
            foreignKeys: [constraints.foreignKey(cols.authorId, Admin.refs.id, { index: false })],
          }),
        ),
      },
    };
  });
}
