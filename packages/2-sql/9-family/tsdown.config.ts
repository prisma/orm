import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/control-adapter.ts',
    'src/exports/ir.ts',
    'src/exports/migration.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
    'src/exports/verify.ts',
    'src/exports/diff.ts',
    'src/exports/psl-ast.ts',
    'src/exports/psl-infer.ts',
  ],
});
