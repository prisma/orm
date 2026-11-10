import { field, model } from '@internal/mongo/contract-builder';

export const User = model('User', { collection: 'users', fields: { _id: field.objectId() } });

export function labelField(input: { readonly type: string }) {
  const { type } = input;
  return { type, builder: field.string() };
}
