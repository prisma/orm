import {
  defineContract,
  enumType,
  field,
  member,
  model,
  rel,
  type,
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
    street: field.scalar(type.String()),
    zip: field.scalar(type.String()).optional(),
  },
});

const Admin = model('Admin', {
  collection: 'users',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    level: field.scalar(type.Int32()),
  },
});

const User = model('User', {
  collection: 'users',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    name: field.scalar(type.String()),
    email: field.scalar(type.String()),
    bio: field.scalar(type.String()).optional(),
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
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    authorId: field.scalar(type.ObjectId()),
    title: field.scalar(type.String()),
    publishedAt: field.scalar(type.Date()).optional(),
  },
  relations: {
    author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
    type: field.scalar(type.String()),
    title: field.scalar(type.String()),
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
    severity: field.scalar(type.Int32()),
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
