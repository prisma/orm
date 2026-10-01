import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: [
    'src/exports/apply-specifier-default-control-policy.ts',
    'src/exports/default-namespace.ts',
    'src/exports/enum-accessor.ts',
    'src/exports/resolve-domain-model.ts',
    'src/exports/types.ts',
    'src/exports/validate-domain.ts',
    'src/exports/contract-validation-error.ts',
    'src/exports/hashing.ts',
    'src/exports/hashing-utils.ts',
    'src/exports/is-plain-record.ts',
    'src/exports/strip-hints.ts',
  ],
});
