import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/pack.ts',
    'src/exports/codec-ids.ts',
    'src/exports/codec-types.ts',
    'src/exports/codecs.ts',
    'src/exports/control.ts',
    'src/exports/data-types.ts',
    'src/exports/migration.ts',
    'src/exports/runtime.ts',
  ],
});
