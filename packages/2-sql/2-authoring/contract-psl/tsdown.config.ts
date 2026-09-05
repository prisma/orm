import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    'attribute-specs': 'src/exports/attribute-specs.ts',
    index: 'src/exports/index.ts',
    provider: 'src/exports/provider.ts',
  },
});
