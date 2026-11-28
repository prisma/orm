import { defineConfig } from '@repo/tsdown';

export default defineConfig({
  entry: {
    'apply-specifier-default-control-policy':
      'src/exports/apply-specifier-default-control-policy.ts',
    'default-namespace': 'src/exports/default-namespace.ts',
    'enum-accessor': 'src/exports/enum-accessor.ts',
    'format-version': 'src/exports/format-version.ts',
    'internal/format-version': 'src/exports/internal-format-version.ts',
    'resolve-domain-model': 'src/exports/resolve-domain-model.ts',
    types: 'src/exports/types.ts',
    'validate-domain': 'src/exports/validate-domain.ts',
    'validate-storage': 'src/exports/validate-storage.ts',
    'contract-validation-error': 'src/exports/contract-validation-error.ts',
    hashing: 'src/exports/hashing.ts',
    'hashing-utils': 'src/exports/hashing-utils.ts',
    'is-plain-record': 'src/exports/is-plain-record.ts',
    'validate-once': 'src/exports/validate-once.ts',
  },
});
