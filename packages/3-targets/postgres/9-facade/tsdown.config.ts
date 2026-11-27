import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    config: 'src/exports/config.ts',
    'contract-builder': 'src/exports/contract-builder.ts',
    control: 'src/exports/control.ts',
    family: 'src/exports/family.ts',
    'contract-types': 'src/exports/contract-types.ts',
    init: 'src/exports/init.ts',
    migration: 'src/exports/migration.ts',
    runtime: 'src/exports/runtime.ts',
    serverless: 'src/exports/serverless.ts',
    static: 'src/exports/static.ts',
    target: 'src/exports/target.ts',
  },
  copy: [{ from: 'src/init/*.md' }],
});
