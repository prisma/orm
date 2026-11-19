import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/adapter.ts',
    'src/exports/codec-types.ts',
    'src/exports/control.ts',
    'src/exports/runtime.ts',
  ],
});
