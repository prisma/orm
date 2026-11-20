import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/exports/types.ts', 'src/runtime/index.ts'],
});
