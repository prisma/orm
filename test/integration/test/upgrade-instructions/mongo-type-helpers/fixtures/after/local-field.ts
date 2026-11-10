import { field, model, type } from '@internal/mongo/contract-builder';

export const User = model('User', { collection: 'users', fields: { _id: field.scalar(type.ObjectId()) } });

export function epoch() {
  const field = { date: () => new Date(0) };
  return field.date();
}
