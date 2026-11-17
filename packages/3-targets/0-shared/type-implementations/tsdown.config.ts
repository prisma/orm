import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/date.ts',
    'src/exports/duration.ts',
    'src/exports/now.ts',
    'src/exports/temporal.ts',
    'src/exports/temporal-text.ts',
  ],
});
