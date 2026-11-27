import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'test/utils': 'test/utils.ts',
  },
  // Keep manual exports to preserve stable root/subpath mapping.
  exports: { enabled: false },
});
