import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/authored-check-naming.ts',
    'src/exports/contract-view.ts',
    'src/exports/data-type.ts',
    'src/exports/data-type-support.ts',
    'src/exports/entity-kinds.ts',
    'src/exports/foreign-key-materialization.ts',
    'src/exports/index-naming.ts',
    'src/exports/referential-action-sql.ts',
    'src/exports/resolve-storage-table.ts',
    'src/exports/types.ts',
    'src/exports/validators.ts',
    'src/exports/factories.ts',
    'src/exports/index-types.ts',
    'src/exports/index-type-validation.ts',
    'src/exports/canonicalization-hooks.ts',
    'src/exports/entity-handle-lowering-hook.ts',
    'src/exports/value-set-derivation-hook.ts',
    'src/exports/sql-expression.ts',
  ],
});
