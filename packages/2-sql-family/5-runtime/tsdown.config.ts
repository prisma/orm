import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'internal/prepared-query': 'src/exports/internal-prepared-query.ts',
    'test/utils': 'test/utils.ts',
  },
  // Keep manual exports to preserve stable root/subpath mapping.
  exports: { enabled: false },
});
