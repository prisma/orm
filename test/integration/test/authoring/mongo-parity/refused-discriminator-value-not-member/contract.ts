import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
} from '@internal/mongo/contract-builder';

const Kind = enumType('Kind', { codecId: 'mongo/string@1' }, member('Bug', 'bug'));

export function buildContract() {
  const Task = model('Task', {
    collection: 'tasks',
    fields: {
      id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
      type: field.namedType(Kind),
    },
    discriminator: { field: 'type', variants: { Bug: { value: 'other' } } },
  });
  return defineContract({
    enums: { Kind },
    models: {
      Task,
      Bug: model('Bug', { base: Task, fields: { severity: field.scalar(type.Int32()) } }),
    },
  });
}
