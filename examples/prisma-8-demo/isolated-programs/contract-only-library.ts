import type { Collection } from '@prisma/orm-postgres/orm-client';
import { expectTypeOf } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';

expectTypeOf<keyof Collection<Contract, 'Post'>['using']>().toBeNever();
