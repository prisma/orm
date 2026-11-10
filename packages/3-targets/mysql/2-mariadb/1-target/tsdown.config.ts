import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: ['src/exports/control.ts', 'src/exports/migration.ts', 'src/exports/pack.ts'],
});
