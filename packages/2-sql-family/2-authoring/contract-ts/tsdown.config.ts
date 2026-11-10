import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    'contract-builder': 'src/exports/contract-builder.ts',
    'config-types': 'src/exports/config-types.ts',
  },
});
