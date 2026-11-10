import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/array-equal.ts',
    'src/exports/assertions.ts',
    'src/exports/abortable.ts',
    'src/exports/canonical-stringify.ts',
    'src/exports/casts.ts',
    'src/exports/defined.ts',
    'src/exports/hash-content.ts',
    'src/exports/internal-error.ts',
    'src/exports/json.ts',
    'src/exports/promise.ts',
    'src/exports/result.ts',
    'src/exports/redact-db-url.ts',
    'src/exports/simplify-deep.ts',
    'src/exports/structured-error.ts',
    'src/exports/suppress-idle-connection-errors.ts',
    'src/exports/text.ts',
    'src/exports/types.ts',
  ],
});
