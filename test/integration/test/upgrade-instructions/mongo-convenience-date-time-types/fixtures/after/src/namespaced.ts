import * as mongo from '@prisma/orm-mongo/contract-builder';

export const at = mongo.field.scalar(mongo.type.DateTime());
