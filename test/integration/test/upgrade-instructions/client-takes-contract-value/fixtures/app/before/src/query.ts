import { mongoQuery } from '@prisma/orm-mongo/query-builder';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const orders = mongoQuery<Contract>({ contractJson }).from('orders');
