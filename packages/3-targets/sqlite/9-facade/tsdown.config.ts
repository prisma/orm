import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/config.ts',
    'src/exports/contract-builder.ts',
    'src/exports/control.ts',
    'src/exports/init.ts',
    'src/exports/contract-types.ts',
    'src/exports/migration.ts',
    'src/exports/runtime.ts',
    'src/exports/static.ts',
  ],
  copy: [{ from: 'src/init/*.md' }],
});
