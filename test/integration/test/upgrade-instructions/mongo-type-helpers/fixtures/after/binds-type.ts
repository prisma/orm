import { type } from 'arktype';
import { field, model } from '@internal/mongo/contract-builder';

export const Schema = type({ name: 'string' });

export const User = model('User', { collection: 'users', fields: { _id: field.objectId() } });
