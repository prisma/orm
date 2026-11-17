import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

import contract = require('./path');

export const db = sqlite<Contract>({ contractJson, path: contract });
