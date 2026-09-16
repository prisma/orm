import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    'attribute-specs': 'src/exports/attribute-specs.ts',
    'default-table-name': 'src/exports/default-table-name.ts',
    index: 'src/exports/index.ts',
    provider: 'src/exports/provider.ts',
    resolution: 'src/exports/resolution.ts',
  },
});
