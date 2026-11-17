import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/descriptor-meta-runtime.ts',
    'src/exports/migration.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
  ],
});
