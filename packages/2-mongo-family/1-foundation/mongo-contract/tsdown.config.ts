import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'normal-form': 'src/exports/normal-form.ts',
    'data-type': 'src/exports/data-type.ts',
    'entity-kinds': 'src/exports/entity-kinds.ts',
    test: 'src/exports/test.ts',
  },
});
