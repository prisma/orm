import mongoStatic from '@prisma/orm-mongo/static';
import { contract } from './contract-value';

export const enums = mongoStatic({ contract }).enums;
