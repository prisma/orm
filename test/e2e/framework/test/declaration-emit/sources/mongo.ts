import {
  defineContract,
  enumType,
  field,
  member,
  model,
  valueObject,
} from '@prisma/orm-mongo/contract-builder';

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const Address = valueObject('Address', { fields: { street: field.string() } });

export const mongo = defineContract({
  enums: { Role },
  valueObjects: { Address },
  models: {
    User: model('User', {
      collection: 'users',
      fields: {
        _id: field.objectId(),
        role: field.namedType(Role),
        address: field.valueObject(Address).optional(),
        embedding: field.vector({ typeParams: { length: 3 } }),
      },
    }),
  },
});
