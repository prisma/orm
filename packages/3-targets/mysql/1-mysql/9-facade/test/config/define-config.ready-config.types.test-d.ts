import type { Contract } from '@internal/contract/types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { test } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

declare const contract: Contract;

test("MySQL's defineConfig takes a contract path only, so no ready contract config reaches it unchecked", () => {
  defineConfig({ contract: './prisma/contract.ts' });
  // @ts-expect-error a ready contract config is not a contract path
  defineConfig({ contract: typescriptContract(contract) });
});
