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

/** A table with a column of each scalar convenience type and a literal default on each. */
export function contractWithScalarTypes() {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      Measure: model('Measure', {
        fields: {
          id: field.column(type.Int()).id(),
          count: field.column(type.BigInt({ as: 'number' })).default(7),
          ratio: field.column(type.Float()).default(0.25),
          amount: field.column(type.Decimal()).default('1.5'),
          price: field.column(type.Decimal({ precision: 10, scale: 2 })).default('-0.5'),
          label: field.column(type.String({ storage: 'text' })).optional(),
          name: field.column(type.String({ length: 40 })).default("it's"),
          on: field.column(type.Boolean()).default(true),
          data: field.column(type.Bytes()).default(new Uint8Array([0, 255])),
          doc: field.column(type.Json()).default({ b: [1, null], a: "it's" }),
          extra: field.column(type.Json()).optional(),
        },
      }),
    },
  }));
}
