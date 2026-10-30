import {
  defineContract,
  enumType,
  field,
  index,
  member,
  model,
  rel,
  type,
  valueObject,
} from '@internal/mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('Reader', 'reader'),
  member('Editor', 'editor'),
);

const Point = valueObject('Point', {
  fields: { lat: field.scalar(type.Double()), lng: field.scalar(type.Double()) },
});

const Address = valueObject('Address', {
  fields: {
    street: field.scalar(type.String()),
    zip: field.scalar(type.String()).optional(),
    location: field.valueObject(Point).optional(),
    tags: field.scalar(type.String()).many(),
    kind: field.namedType(Role).optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
    nickname: field.scalar(type.String()).optional(),
    age: field.scalar(type.Int32()),
    score: field.scalar(type.Double()),
    scores: field.scalar(type.Double()).many(),
    visits: field.scalar(type.Int64()),
    balance: field.scalar(type.Decimal128()),
    active: field.scalar(type.Bool()),
    joinedAt: field.scalar(type.Date()),
    avatar: field.scalar(type.Binary()).optional(),
    settings: field.scalar(type.Json()),
    raw: field.scalar(type.Bson()).optional(),
    role: field.namedType(Role),
    pastRoles: field.namedType(Role).many({ elementsNullable: true }),
    nicknames: field.scalar(type.String()).optional().many(),
    embedding: field.scalar(type.Vector(3)),
    rawEmbedding: field.scalar(type.Vector()),
    home: field.valueObject(Address).optional(),
    pastHomes: field.valueObject(Address).many(),
  },
  indexes: [index({ email: 1 }, { unique: true })],
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    _id: field.scalar(type.ObjectId()),
    authorId: field.scalar(type.ObjectId()),
    title: field.scalar(type.String()),
    kind: field.scalar(type.String()),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id') }),
  },
  discriminator: {
    field: 'kind',
    variants: { Article: { value: 'article' }, Link: { value: 'link' } },
  },
});

const Article = model('Article', {
  collection: 'posts',
  base: Post,
  fields: { body: field.scalar(type.String()) },
});

const Link = model('Link', {
  collection: 'posts',
  base: Post,
  fields: { url: field.scalar(type.String()) },
});

export const contract = defineContract({
  enums: { Role },
  valueObjects: { Point, Address },
  models: { User, Post, Article, Link },
});
