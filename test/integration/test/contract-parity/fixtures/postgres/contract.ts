/**
 * The type constructors, id generators, parameterized codecs and relation shapes the planner golden fixture leaves out, so the parity test compares them with their emitted types.
 */

import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { arktypeJson } from '@internal/extension-arktype-json/column-types';
import arktypeJsonPack from '@internal/extension-arktype-json/pack';
import {
  defineContract,
  enumType,
  field,
  fullTextIndex,
  gen,
  member,
  model,
  rel,
  sql,
  type,
} from '@internal/postgres/contract-builder';
import { type as arktype } from 'arktype';

const TimestampString3 = field.column({
  codecId: 'pg/timestamp-string@1',
  typeParams: { precision: 3 },
} as const);
const TimestamptzString3 = field.column({
  codecId: 'pg/timestamptz-string@1',
  typeParams: { precision: 3 },
} as const);

const Plan = enumType(
  'Plan',
  { codecId: 'pg/text@1' } as const,
  member('Free', 'free'),
  member('Paid', 'paid'),
);

const Ratio = enumType(
  'Ratio',
  { codecId: 'pg/numeric@1' } as const,
  member('Half', '0.5'),
  member('Whole', '1.50'),
);

const pgVarchar20 = { codecId: 'pg/varchar@1', typeParams: { length: 20 } } as const;

const User = model('User', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid(7)),
    email: field.column(textColumn),
    externalId: field.column(type.Char(36)),
    ulid: field.column(type.Char(26)),
    nanoid: field.column(type.Char(21)),
    shortNanoid: field.column(type.Char(10)),
    cuid2: field.column(type.Char(24)),
    ksuid: field.column(type.Char(27)),
    createdAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()),
    updatedAt: field.column(timestamptzTemporalColumn).onCreate(gen.now()).onUpdate(gen.now()),
    timestamp: field.column(type.TimestampTemporal(3)),
    timestamptz: field.column(type.TimestamptzTemporal(6)).onCreate(gen.now()),
    timestampString: field.column(type.TimestampString(3)),
    timestamptzString: field
      .column(type.TimestamptzString(3))
      .onCreate(gen.now())
      .onUpdate(gen.now()),
    timestampStringAlias: TimestampString3,
    timestamptzStringAlias: TimestamptzString3.optional(),
    seenAt: field.column(type.TimestamptzJsDate(3)),
    handle: field.column(pgVarchar20),
    plan: field.namedType(Plan),
    ratio: field.namedType(Ratio),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    authorId: field.column(type.Char(36)),
    title: field.column(textColumn),
  },
});

const Tag = model('Tag', {
  fields: {
    id: field.column(type.Char(26)).id().onCreate(gen.ulid()),
    label: field.column(textColumn),
  },
});

const PostTag = model('PostTag', {
  fields: { postId: field.column(type.Char(36)), tagId: field.column(type.Char(26)) },
});

const Generated = model('Generated', {
  fields: {
    id: field.column(type.Char(36)).onCreate(gen.uuid()).id(),
    uuidv7: field.column(type.Char(36)).onCreate(gen.uuid(7)),
    ulid: field.column(type.Char(26)).onCreate(gen.ulid()),
    nanoid: field.column(type.Char(21)).onCreate(gen.nanoid()),
    shortNanoid: field.column(type.Char(12)).onCreate(gen.nanoid(12)),
    cuid2: field.column(type.Char(24)).onCreate(gen.cuid(2)),
    ksuid: field.column(type.Char(27)).onCreate(gen.ksuid()),
  },
});

const Employee = model('Employee', {
  fields: {
    id: field.column(type.Char(21)).id().onCreate(gen.nanoid()),
    managerId: field.column(type.Char(21)).optional(),
  },
});

const Badge = model('Badge', {
  fields: { id: field.column(int4Column), code: field.column(textColumn).unique() },
});

const UserBadge = model('UserBadge', {
  fields: { userId: field.column(type.Char(36)), badgeCode: field.column(textColumn) },
});

// Foreign keys whose backing indexes the build names, cuts or leaves out.
const LongNamed = model('LongNamed', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    organizationReference: field.column(type.Char(36)).column('organization_reference_identifier'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'organization_membership_invitations',
  foreignKeys: [constraints.foreignKey(cols.organizationReference, User.refs.id)],
}));

const PartialIndexed = model('PartialIndexed', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    writerId: field.column(type.Char(36)).column('writer_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'partial_writers',
  indexes: [
    constraints.index([cols.writerId], { name: 'set_writers', where: sql`writer_id IS NOT NULL` }),
  ],
  foreignKeys: [constraints.foreignKey(cols.writerId, User.refs.id)],
}));

const PlainIndexed = model('PlainIndexed', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    writerId: field.column(type.Char(36)).column('writer_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'plain_writers',
  indexes: [constraints.index([cols.writerId], { name: 'by_writer' })],
  foreignKeys: [constraints.foreignKey(cols.writerId, User.refs.id)],
}));

const KeyCovered = model('KeyCovered', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    writerId: field.column(type.Char(36)).column('writer_id').unique(),
  },
}).sql(({ cols, constraints }) => ({
  table: 'key_writers',
  foreignKeys: [constraints.foreignKey(cols.writerId, User.refs.id)],
}));

const Unindexed = model('Unindexed', {
  fields: {
    id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
    writerId: field.column(type.Char(36)).column('writer_id'),
  },
}).sql(({ cols, constraints }) => ({
  table: 'unindexed_writers',
  foreignKeys: [constraints.foreignKey(cols.writerId, User.refs.id, { index: false })],
}));

const Account = model('Account', {
  namespace: 'auth',
  fields: {
    id: field.column(type.Char(24)).id().onCreate(gen.cuid(2)),
    userId: field.column(type.Char(36)),
    provider: field.column(textColumn),
  },
});

const Profile = model('Profile', {
  fields: {
    id: field.column(type.Char(27)).id().onCreate(gen.ksuid()),
    userId: field.column(type.Char(36)),
    rank: field.column(int4Column),
    settings: field.column(arktypeJson(arktype({ theme: 'string', fontSize: 'number' }))),
  },
});

export const contract = defineContract({
  extensions: { 'arktype-json': arktypeJsonPack },
  namespaces: ['auth'],
  enums: { Plan, Ratio },
  models: {
    User: User.relations({
      posts: rel.hasMany(Post, { by: 'authorId' }),
      accounts: rel.hasMany(Account, { by: 'userId' }),
      profile: rel.hasOne(Profile, { by: 'userId' }),
      badges: rel.manyToMany(Badge, { through: UserBadge, from: 'userId', to: 'badgeCode' }),
    }).sql(({ cols, constraints }) => ({
      table: 'users',
      indexes: [
        constraints.index([cols.handle]),
        constraints.index([cols.email], { map: 'users_email_exact' }),
        constraints.index([cols.nanoid, cols.cuid2], { name: 'by_short_ids', unique: true }),
        fullTextIndex([[cols.email], cols.handle], { name: 'search_docs', language: 'german' }),
      ],
    })),
    Badge: Badge.sql({ table: 'badges' }),
    LongNamed,
    PartialIndexed,
    PlainIndexed,
    KeyCovered,
    Unindexed,
    UserBadge: UserBadge.sql({ table: 'user_badges' }),
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
    Account: Account.relations({
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
    }).sql({ table: 'accounts' }),
    Profile: Profile.relations({
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: { onDelete: 'cascade' } }),
    }).sql({ table: 'profiles' }),
  },
});
