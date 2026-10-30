import { field, model } from '@internal/mongo/contract-builder';

export const User = model('User', { collection: 'users', fields: { _id: field.objectId() } });

export function type(): string {
  return 'user';
}
