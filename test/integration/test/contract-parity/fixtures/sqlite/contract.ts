/**
 * The type constructors, id generators and relation shapes the planner golden fixture leaves out, so the parity test compares them with their emitted types.
 */

import { integerColumn, textColumn } from '@internal/adapter-sqlite/column-types';
import { defineContract } from '@internal/sqlite/contract-builder';

// The foreign key defaults turn backing indexes off, so only a foreign key that asks for one gets it.
export const contract = defineContract(
  { foreignKeyDefaults: { constraint: true, index: false } },
  ({ field, model, rel, gen, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid(7)),
        email: field.column(textColumn),
        externalId: field.column(type.sql.Char(36)),
        ulid: field.column(type.sql.Char(26)),
        nanoid: field.column(type.sql.Char(21)),
        shortNanoid: field.column(type.sql.Char(10)),
        cuid2: field.column(type.sql.Char(24)),
        ksuid: field.column(type.sql.Char(27)),
        createdAt: field.column(type.temporal.CreatedAt()),
        updatedAt: field.column(type.temporal.UpdatedAt()),
        seenAt: field.column(type.DateTime()),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
        authorId: field.column(type.sql.Char(36)),
        title: field.column(textColumn),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(type.sql.Char(26)).id().onCreate(gen.ulid()),
        label: field.column(textColumn),
      },
    });

    const PostTag = model('PostTag', {
      fields: { postId: field.column(type.sql.Char(36)), tagId: field.column(type.sql.Char(26)) },
    });

    const Generated = model('Generated', {
      fields: {
        id: field.column(type.sql.Char(36)).onCreate(gen.uuid()).id(),
        uuidv7: field.column(type.sql.Char(36)).onCreate(gen.uuid(7)),
        ulid: field.column(type.sql.Char(26)).onCreate(gen.ulid()),
        nanoid: field.column(type.sql.Char(21)).onCreate(gen.nanoid()),
        shortNanoid: field.column(type.sql.Char(12)).onCreate(gen.nanoid(12)),
        cuid2: field.column(type.sql.Char(24)).onCreate(gen.cuid(2)),
        ksuid: field.column(type.sql.Char(27)).onCreate(gen.ksuid()),
      },
    });

    const Employee = model('Employee', {
      fields: {
        id: field.column(type.sql.Char(21)).id().onCreate(gen.nanoid()),
        managerId: field.column(type.sql.Char(21)).optional(),
      },
    });

    const Profile = model('Profile', {
      fields: {
        id: field.column(type.sql.Char(27)).id().onCreate(gen.ksuid()),
        userId: field.column(type.sql.Char(36)),
        rank: field.column(integerColumn),
      },
    });

    return {
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'authorId' }),
          profile: rel.hasOne(Profile, { by: 'userId' }),
        }).sql(({ cols, constraints }) => ({
          table: 'users',
          indexes: [
            constraints.index([cols.email]),
            constraints.index([cols.ulid], { map: 'users_ulid_exact' }),
            constraints.index([cols.nanoid, cols.cuid2], { name: 'by_short_ids', unique: true }),
          ],
        })),
        Post: Post.relations({
          author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
          tags: rel.manyToMany(Tag, { through: PostTag, from: 'postId', to: 'tagId' }),
        }).sql(({ cols, constraints }) => ({
          table: 'posts',
          foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id)],
        })),
        Tag: Tag.relations({
          posts: rel.manyToMany(Post, { through: PostTag, from: 'tagId', to: 'postId' }),
        }).sql({ table: 'tags' }),
        PostTag: PostTag.sql({ table: 'post_tags' }),
        Generated: Generated.sql({ table: 'generated' }),
        Employee: Employee.relations({
          manager: rel.belongsTo(Employee, { from: 'managerId', to: 'id' }),
          reports: rel.hasMany(Employee, { by: 'managerId' }),
        }).sql({ table: 'employees' }),
        Profile: Profile.relations({
          user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: { index: true } }),
        }).sql({ table: 'profiles' }),
      },
    };
  },
);
