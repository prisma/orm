import { field, type as types } from '@prisma/orm-mongo/contract-builder';

export const reviewedAt = field.scalar(types.Date());
export const plainDate = new Date().getUTCDate();
