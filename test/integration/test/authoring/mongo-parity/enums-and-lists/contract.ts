import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
  valueObject,
} from '@internal/mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('Member', 'member'),
  member('Editor', 'editor'),
);
const Level = enumType('Level', { codecId: 'mongo/int32@1' }, member('Low', 1), member('High', 10));

const Badge = valueObject('Badge', {
  fields: { label: field.scalar(type.String()), level: field.namedType(Level) },
});

export const contract = defineContract({
  enums: { Role, Level },
  valueObjects: { Badge },
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        role: field.namedType(Role),
        levels: field.namedType(Level).many(),
        roles: field.namedType(Role).optional().many(),
        tags: field.scalar(type.String()).many(),
        aliases: field.scalar(type.String()).optional().many(),
        badge: field.valueObject(Badge),
        badges: field.valueObject(Badge).many(),
      },
    }),
  },
});
