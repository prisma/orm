import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/config-resolve.ts',
    'src/exports/config-types.ts',
    'src/exports/config-validation.ts',
  ],
});
