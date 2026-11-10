import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/runtime.ts',
    'src/exports/codec-types.ts',
    'src/exports/column-types.ts',
    'src/exports/pack.ts',
  ],
});
