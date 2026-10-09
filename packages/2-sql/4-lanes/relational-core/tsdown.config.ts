import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/exports/types.ts',
    'src/exports/aggregate-descriptor-registry.ts',
    'src/exports/ast.ts',
    'src/exports/codec-descriptor-registry.ts',
    'src/exports/contract-free.ts',
    'src/exports/expression.ts',
    'src/exports/functions.ts',
    'src/exports/index-reference.ts',
    'src/exports/middleware.ts',
    'src/exports/plan.ts',
    'src/exports/query-lane-context.ts',
  ],
});
