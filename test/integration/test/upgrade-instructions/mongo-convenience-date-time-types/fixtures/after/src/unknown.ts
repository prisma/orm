import { field } from '@prisma/orm-mongo/contract-builder';
import { types } from './types';

export const at = field.scalar(types.Date());
