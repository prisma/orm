import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'contract-factories': 'src/contract-factories.ts',
    'data-loss-expectations': 'src/data-loss-expectations.ts',
    'column-descriptors': 'src/column-descriptors.ts',
    'lowered-params': 'src/lowered-params.ts',
    'operation-descriptors': 'src/operation-descriptors.ts',
    'semantic-lines': 'src/semantic-lines.ts',
    timeouts: 'src/timeouts.ts',
    'typed-expectations': 'src/typed-expectations.ts',
  },
  external: ['@internal/contract', '@prisma/dev', 'pg', 'vitest', /^node:/],
  outDir: 'dist/exports',
  // Keep manual exports to preserve root "." mapping with this custom outDir layout.
  exports: { enabled: false },
  dts: { enabled: true, sourcemap: true },
  sourcemap: true,
});
