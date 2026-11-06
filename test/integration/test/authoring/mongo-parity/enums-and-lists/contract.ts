import {
  defineContract,
  enumType,
  field,
  member,
  model,
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
  fields: { label: field.string(), level: field.namedType(Level) },
});

export const contract = defineContract({
  enums: { Role, Level },
  valueObjects: { Badge },
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        id: field.objectId().mongo({ field: '_id' }),
        role: field.namedType(Role),
        levels: field.namedType(Level).many(),
        roles: field.namedType(Role).optional().many(),
        tags: field.string().many(),
        aliases: field.string().optional().many(),
        badge: field.valueObject(Badge),
        badges: field.valueObject(Badge).many(),
      },
    }),
  },
});
