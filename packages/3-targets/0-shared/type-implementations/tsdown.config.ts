import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/boolean.ts',
    'src/exports/date.ts',
    'src/exports/decimal.ts',
    'src/exports/duration.ts',
    'src/exports/json.ts',
    'src/exports/now.ts',
    'src/exports/temporal.ts',
    'src/exports/temporal-text.ts',
  ],
});
