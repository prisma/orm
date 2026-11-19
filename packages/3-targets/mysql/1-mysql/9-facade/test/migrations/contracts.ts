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

/** A table whose defaults are the empty or edge values of the bytes, text and JSON columns, whose reported forms differ from the others, and a whole number on a `decimal` written without a precision. */
export function contractWithEdgeDefaults() {
  return defineContract({}, ({ field, model, type }) => ({
    models: {
      Edge: model('Edge', {
        fields: {
          id: field.column(type.Int()).id(),
          noBytes: field.column(type.Bytes()).default(new Uint8Array()),
          bytes: field.column(type.Bytes()).default(new Uint8Array([0xc3, 0xa9, 0, 0xff])),
          blank: field.column(type.String({ storage: 'text' })).default(''),
          accented: field.column(type.String({ storage: 'text' })).default('é€😀'),
          jsonNull: field.column(type.Json()).optional().default(null),
          jsonString: field.column(type.Json()).default(''),
          jsonArray: field.column(type.Json()).default([]),
          jsonObject: field.column(type.Json()).default({}),
          jsonAccented: field.column(type.Json()).default({ k: 'é€😀' }),
          zero: field.column(type.Decimal({ precision: 10, scale: 2 })).default('0'),
          whole: field.column(type.NumericString()).default('-12'),
          off: field.column(type.Boolean()).default(false),
          tiny: field.column(type.Float()).default(5e-324),
        },
      }),
    },
  }));
}

/** A table with one key on a `Bytes`, a `Json` or a `String(storage: text)` field, as `key` says. */
export function contractWithKeyOn(key: 'bytes' | 'json' | 'text', kind: 'id' | 'unique') {
  return defineContract({}, ({ field, model, type }) => {
    const column = {
      bytes: () => field.column(type.Bytes()),
      json: () => field.column(type.Json()),
      text: () => field.column(type.String({ storage: 'text' })),
    }[key]();
    return {
      models: {
        Keyed: model('Keyed', {
          fields:
            kind === 'id'
              ? { key: column.id() }
              : { id: field.column(type.Int()).id(), key: column.unique() },
        }),
      },
    };
  });
}
