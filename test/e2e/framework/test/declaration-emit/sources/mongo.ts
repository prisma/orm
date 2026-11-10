import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
  valueObject,
} from '@prisma/orm-mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const Address = valueObject('Address', { fields: { street: field.scalar(type.String()) } });

export const mongo = defineContract({
  enums: { Role },
  valueObjects: { Address },
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        _id: field.scalar(type.ObjectId()),
        role: field.namedType(Role),
        address: field.valueObject(Address).optional(),
        embedding: field.scalar(type.Vector(3)),
      },
    }),
  },
});
