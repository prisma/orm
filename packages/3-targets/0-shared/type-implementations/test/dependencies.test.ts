import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

function dependencyNames(field: string): readonly string[] {
  const declared =
    typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, field) : undefined;
  return typeof declared === 'object' && declared !== null ? Object.keys(declared) : [];
}

describe('the package, which depends on no database, family or other Prisma package', () => {
  it('has temporal-spec as its only runtime dependency', () => {
    expect({
      dependencies: dependencyNames('dependencies'),
      optionalDependencies: dependencyNames('optionalDependencies'),
      peerDependencies: dependencyNames('peerDependencies'),
    }).toEqual({
      dependencies: ['temporal-spec'],
      optionalDependencies: [],
      peerDependencies: ['typescript'],
    });
  });
});
