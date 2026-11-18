import type { Contract } from '@internal/contract/types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { test } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

declare const contract: Contract;

test("MySQL's defineConfig takes only a contract path: if it is to take a ready contract config, pass that config through refuseOtherTargetOnLoad first", () => {
  defineConfig({ contract: './prisma/contract.ts' });
  // @ts-expect-error a ready contract config is not a contract path
  defineConfig({ contract: typescriptContract(contract) });
});
