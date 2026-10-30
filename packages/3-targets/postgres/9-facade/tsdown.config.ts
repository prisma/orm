import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    config: 'src/exports/config.ts',
    'contract-builder': 'src/exports/contract-builder.ts',
    control: 'src/exports/control.ts',
    family: 'src/exports/family.ts',
    migration: 'src/exports/migration.ts',
    runtime: 'src/exports/runtime.ts',
    serverless: 'src/exports/serverless.ts',
    static: 'src/exports/static.ts',
    target: 'src/exports/target.ts',
    'internal/options': 'src/exports/internal-options.ts',
    'internal/static-context': 'src/exports/internal-static-context.ts',
    'internal/transaction-members': 'src/exports/internal-transaction-members.ts',
    'internal/validate-contract': 'src/exports/internal-validate-contract.ts',
  },
});
