import { field, model, type } from '@internal/mongo/contract-builder';

export const User = model('User', { collection: 'users', fields: { _id: field.scalar(type.ObjectId()) } });

export function labelField(input: { readonly type: string }) {
  const { type } = input;
  return { type, builder: field.string() };
}
