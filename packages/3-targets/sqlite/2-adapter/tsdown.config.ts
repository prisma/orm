import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/adapter.ts',
    'src/exports/types.ts',
    'src/exports/codec-types.ts',
    'src/exports/column-types.ts',
    'src/exports/control.ts',
    'src/exports/runtime.ts',
    'src/exports/sql-renderer.ts',
  ],
});
