import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
  },
});
