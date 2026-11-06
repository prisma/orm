import {
  defineContract,
  enumType,
  field,
  member,
  model,
  rel,
  valueObject,
} from '@internal/mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('Member', 'member'),
  member('Editor', 'editor'),
);

const Address = valueObject('Address', {
  fields: {
    street: field.string(),
    zip: field.string().optional(),
  },
});

const Admin = model('Admin', {
  collection: 'users',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    level: field.int32(),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    name: field.string(),
    email: field.string(),
    bio: field.string().optional(),
    role: field.namedType(Role),
    address: field.valueObject(Address).optional(),
  },
  relations: {
    posts: rel.hasMany('Post', { from: 'id', to: 'authorId' }),
  },
});

const Post = model('Post', {
  collection: 'posts',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    authorId: field.objectId(),
    title: field.string(),
    publishedAt: field.date().optional(),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.objectId().mongo({ field: '_id' }),
    type: field.string(),
    title: field.string(),
  },
  discriminator: {
    field: 'type',
    variants: {
      Bug: { value: 'bug' },
    },
  },
});

const Bug = model('Bug', {
  collection: 'tasks',
  base: Task,
  fields: {
    severity: field.int32(),
  },
});

export const contract = defineContract({
  enums: { Role },
  valueObjects: { Address },
  models: {
    Admin,
    User,
    Post,
    Task,
    Bug,
  },
});
