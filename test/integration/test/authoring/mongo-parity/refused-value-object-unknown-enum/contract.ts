import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
  valueObject,
} from '@internal/mongo/contract-builder';

const Level = enumType('Level', { codecId: 'mongo/string@1' }, member('Low', 'low'));

export function buildContract() {
  const Badge = valueObject('Badge', { fields: { level: field.namedType(Level) } });
  return defineContract({
    valueObjects: { Badge },
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          badge: field.valueObject(Badge),
        },
      }),
    },
  });
}
