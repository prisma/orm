import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/aggregates.ts',
    'src/exports/codec-ids.ts',
    'src/exports/data-types.ts',
    'src/exports/codec-types.ts',
    'src/exports/codec-descriptor.ts',
    'src/exports/codecs.ts',
    'src/exports/control.ts',
    'src/exports/contract-free.ts',
    'src/exports/ddl.ts',
    'src/exports/default-normalizer.ts',
    'src/exports/migration.ts',
    'src/exports/native-type-normalizer.ts',
    'src/exports/op-factory-call.ts',
    'src/exports/pack.ts',
    'src/exports/planner.ts',
    'src/exports/planner-produced-sqlite-migration.ts',
    'src/exports/planner-target-details.ts',
    'src/exports/render-ops.ts',
    'src/exports/runtime.ts',
    'src/exports/sql-utils.ts',
    'src/exports/control-tables.ts',
  ],
});
