import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/codec-descriptor.ts',
    'src/exports/codec-ids.ts',
    'src/exports/codec-types.ts',
    'src/exports/codecs.ts',
    'src/exports/contract-free.ts',
    'src/exports/control.ts',
    'src/exports/control-tables.ts',
    'src/exports/data-types.ts',
    'src/exports/ddl.ts',
    'src/exports/default-normalizer.ts',
    'src/exports/errors.ts',
    'src/exports/marker-lock.ts',
    'src/exports/migration.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
    'src/exports/sql-utils.ts',
  ],
});
