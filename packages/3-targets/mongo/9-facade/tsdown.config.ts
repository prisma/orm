import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/bson.ts',
    'src/exports/config.ts',
    'src/exports/contract-builder.ts',
    'src/exports/control.ts',
    'src/exports/family.ts',
    'src/exports/runtime.ts',
    'src/exports/static.ts',
    'src/exports/target.ts',
  ],
});
