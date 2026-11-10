import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: ['src/exports/codec-types.ts', 'src/exports/control.ts'],
});
