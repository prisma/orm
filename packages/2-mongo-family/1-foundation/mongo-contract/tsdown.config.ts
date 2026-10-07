import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'canonicalization-hooks': 'src/exports/canonicalization-hooks.ts',
    'data-type': 'src/exports/data-type.ts',
    'entity-kinds': 'src/exports/entity-kinds.ts',
  },
});
