import { field, type as types } from '@prisma/orm-mongo/contract-builder';

export const reviewedAt = field.scalar(types.DateTime());
export const plainDate = new Date().getUTCDate();
