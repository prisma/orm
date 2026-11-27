import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: ['src/exports/capabilities.ts', 'src/exports/control.ts', 'src/exports/runtime.ts'],
});
