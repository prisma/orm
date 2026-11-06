import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
  },
});
