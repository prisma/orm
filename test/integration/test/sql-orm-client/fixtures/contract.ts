import {
  charColumn,
  int4Column,
  jsonbColumn,
  textColumn,
} from '@internal/adapter-postgres/column-types';
import { vector } from '@internal/extension-pgvector/column-types';
import pgvector from '@internal/extension-pgvector/pack';
import { uuidv4 } from '@internal/ids';
import { defineContract, field, model, now, rel } from '@internal/postgres/contract-builder';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn).unique(),
    invitedById: field.column(int4Column).optional().column('invited_by_id'),
    address: field.column(jsonbColumn).optional(),
  },
});

const PostBase = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
    views: field.column(int4Column),
    embedding: field.column(vector(3)).optional(),
  },
});

const Comment = model('Comment', {
  fields: {
    id: field.column(int4Column).id(),
    body: field.column(textColumn),
    postId: field.column(int4Column).column('post_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'comments',
  foreignKeys: [constraints.foreignKey(cols.postId, PostBase.refs.id)],
}));

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).column('user_id').unique(),
    bio: field.column(textColumn),
  },
  relations: {
    user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }),
  },
}).sql({ table: 'profiles' });

const Article = model('Article', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    reviewerId: field.column(int4Column).column('reviewer_id'),
  },
  relations: {
    reviewer: rel.belongsTo(UserBase, { from: 'reviewerId', to: 'id' }),
  },
}).sql({ table: 'articles' });

const Tag = model('Tag', {
  fields: {
    id: field.generated(uuidv4()).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'tags' });

const UserTag = model('UserTag', {
  fields: {
    userId: field.column(int4Column).column('user_id'),
    tagId: field.column(charColumn(36)).column('tag_id'),
    note: field.column(textColumn).optional(),
    createdAt: field.column(textColumn).column('created_at').default(now()),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.tagId]),
  }))
  .sql({ table: 'user_tags' });

const Role = model('Role', {
  fields: {
    id: field.generated(uuidv4()).id(),
    name: field.column(textColumn).unique(),
  },
}).sql({ table: 'roles' });

const UserRole = model('UserRole', {
  fields: {
    userId: field.column(int4Column).column('user_id'),
    roleId: field.column(charColumn(36)).column('role_id'),
    level: field.column(int4Column),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.userId, fields.roleId]),
  }))
  .sql({ table: 'user_roles' });

const ProjectBase = model('Project', {
  fields: {
    tenantId: field.column(int4Column).column('tenant_id'),
    id: field.column(int4Column),
    name: field.column(textColumn),
  },
}).attributes(({ fields, constraints }) => ({
  id: constraints.id([fields.tenantId, fields.id]),
}));

const Project = ProjectBase.relations({
  related: rel.manyToMany(() => ProjectBase, {
    through: () => ProjectLink,
    from: ['srcTenantId', 'srcId'],
    to: ['dstTenantId', 'dstId'],
  }),
}).sql({ table: 'projects' });

const ProjectLink = model('ProjectLink', {
  fields: {
    srcTenantId: field.column(int4Column).column('src_tenant_id'),
    srcId: field.column(int4Column).column('src_id'),
    dstTenantId: field.column(int4Column).column('dst_tenant_id'),
    dstId: field.column(int4Column).column('dst_id'),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.srcTenantId, fields.srcId, fields.dstTenantId, fields.dstId]),
  }))
  .sql({ table: 'project_links' });

const Post = PostBase.relations({
  comments: rel.hasMany(() => Comment, { by: 'postId' }),
  author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }).sql({ fk: {} }),
}).sql({ table: 'posts' });

const User = UserBase.relations({
  invitedUsers: rel.hasMany(() => UserBase, { by: 'invitedById' }),
  invitedBy: rel.belongsTo(UserBase, { from: 'invitedById', to: 'id' }).sql({ fk: {} }),
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  profile: rel.hasOne(() => Profile, { by: 'userId' }),
  tags: rel.manyToMany(() => Tag, {
    through: () => UserTag,
    from: 'userId',
    to: 'tagId',
  }),
  roles: rel.manyToMany(() => Role, {
    through: () => UserRole,
    from: 'userId',
    to: 'roleId',
  }),
}).sql({ table: 'users' });

const baseContract = defineContract({
  extensions: { pgvector },
  models: {
    User,
    Post,
    Comment,
    Profile,
    Article,
    Tag,
    UserTag,
    Role,
    UserRole,
    Project,
    ProjectLink,
  },
});

const defaultNamespace = baseContract.domain.namespaces['public']!;
const userModel = defaultNamespace.models['User']!;

export const contract = {
  ...baseContract,
  domain: {
    namespaces: {
      ...baseContract.domain.namespaces,
      public: {
        ...defaultNamespace,
        models: {
          ...defaultNamespace.models,
          User: {
            ...userModel,
            fields: {
              ...userModel.fields,
              address: {
                nullable: true as const,
                type: { kind: 'valueObject' as const, name: 'Address' },
              },
            },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: {
                nullable: false as const,
                type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
              },
              city: {
                nullable: false as const,
                type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
              },
              zip: {
                nullable: true as const,
                type: { kind: 'scalar' as const, codecId: 'pg/text@1' as const },
              },
            },
          },
        },
      },
    },
  },
};
