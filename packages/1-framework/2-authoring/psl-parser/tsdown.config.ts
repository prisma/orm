import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/index.ts',
    'src/exports/tokenizer.ts',
    'src/exports/syntax.ts',
    'src/exports/format.ts',
    'src/exports/interpret.ts',
    'src/exports/test.ts',
  ],
});
