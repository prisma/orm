import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const pair = [1, 2];
export const [, contract] = pair;

export const db = sqlite<Contract>({ contractJson, path: './dev.db' });
