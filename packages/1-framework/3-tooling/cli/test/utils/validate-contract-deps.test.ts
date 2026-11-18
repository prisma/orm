import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractPackageSpecifiers,
  validateContractDeps,
} from '../../src/utils/validate-contract-deps';

describe('extractPackageSpecifiers', () => {
  it('extracts scoped package names from import type statements', () => {
    const dts = `import type { Foo } from '@example-org/codec-types';
import type { Bar } from '@internal/sql-contract/types';
import type { Contract } from '@internal/contract/types';`;

    const result = extractPackageSpecifiers(dts);

    expect(result).toEqual([
      '@example-org/codec-types',
      '@internal/sql-contract',
      '@internal/contract',
    ]);
  });

  it('returns empty array when no imports present', () => {
    const dts = 'export type Contract = { readonly models: {} };';

    expect(extractPackageSpecifiers(dts)).toEqual([]);
  });

  it('deduplicates repeated packages', () => {
    const dts = `import type { A } from '@internal/contract/types';
import type { B } from '@internal/contract/hashing';`;

    expect(extractPackageSpecifiers(dts)).toEqual(['@internal/contract']);
  });

  it('extracts from double-quoted import specifiers', () => {
    const dts = `import type { Foo } from "@example-org/codec-types";
import type { Bar } from "@internal/sql-contract/types";`;

    const result = extractPackageSpecifiers(dts);

    expect(result).toEqual(['@example-org/codec-types', '@internal/sql-contract']);
  });
});

describe('validateContractDeps', () => {
  it('returns no missing packages when all resolve', () => {
    const dts = `import type { Foo } from '@internal/contract/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toEqual([]);
  });

  it('returns missing packages when they cannot be resolved', () => {
    const dts = `import type { Foo } from '@nonexistent-scope/fake-package/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toEqual(['@nonexistent-scope/fake-package']);
  });

  it('accepts a relative project root — createRequire needs an absolute path', () => {
    const dts = `import type { Foo } from '@internal/contract/types';`;
    const relativeRoot = relative(process.cwd(), __dirname);

    const result = validateContractDeps(dts, `./${relativeRoot}`);

    expect(result.missing).toEqual([]);
  });

  it('formats a warning message listing missing packages', () => {
    const dts = `import type { Foo } from '@nonexistent-scope/pkg-a/types';
import type { Bar } from '@nonexistent-scope/pkg-b/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.missing).toContain('@nonexistent-scope/pkg-a');
    expect(result.missing).toContain('@nonexistent-scope/pkg-b');
    expect(result.warning).toContain('@nonexistent-scope/pkg-a');
    expect(result.warning).toContain('@nonexistent-scope/pkg-b');
    expect(result.warning).toContain('Install them with your package manager');
    expect(result.warning).not.toContain('pnpm add');
  });

  it('returns no warning when all packages resolve', () => {
    const dts = `import type { Foo } from '@internal/contract/types';`;

    const result = validateContractDeps(dts, __dirname);

    expect(result.warning).toBeUndefined();
  });
});
