import {
  defineContract,
  enumType,
  field,
  index,
  member,
  model,
  rel,
  valueObject,
} from '@internal/mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('Reader', 'reader'),
  member('Editor', 'editor'),
);

const Point = valueObject('Point', {
  fields: { lat: field.double(), lng: field.double() },
});

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
    location: field.valueObject(Point).optional(),
    tags: field.string().many(),
    kind: field.namedType(Role).optional(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    email: field.string(),
    nickname: field.string().optional(),
    age: field.int32(),
    score: field.double(),
    scores: field.double().many(),
    visits: field.int64(),
    balance: field.decimal128(),
    active: field.bool(),
    joinedAt: field.date(),
    avatar: field.binary().optional(),
    settings: field.json(),
    raw: field.bson().optional(),
    role: field.namedType(Role),
    pastRoles: field.namedType(Role).many({ elementsNullable: true }),
    nicknames: field.string().optional().many(),
    embedding: field.vector({ typeParams: { length: 3 } }),
    rawEmbedding: field.vector(),
    home: field.valueObject(Address).optional(),
    pastHomes: field.valueObject(Address).many(),
  },
  indexes: [index({ email: 1 }, { unique: true })],
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    _id: field.objectId(),
    authorId: field.objectId(),
    title: field.string(),
    kind: field.string(),
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
  fields: { body: field.string() },
});

const Link = model('Link', {
  collection: 'posts',
  base: Post,
  fields: { url: field.string() },
});

export const contract = defineContract({
  enums: { Role },
  valueObjects: { Point, Address },
  models: { User, Post, Article, Link },
});
