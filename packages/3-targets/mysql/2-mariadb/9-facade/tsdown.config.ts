import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/config.ts',
    'src/exports/control.ts',
    'src/exports/contract-types.ts',
    'src/exports/migration.ts',
  ],
});
