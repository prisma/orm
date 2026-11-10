import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readPackageJson(): {
  readonly exports?: Record<string, string>;
} {
  const packageJsonUrl = new URL('../package.json', import.meta.url);
  return JSON.parse(readFileSync(packageJsonUrl, 'utf8')) as {
    readonly exports?: Record<string, string>;
  };
}

describe('package exports', () => {
  it('does not export the removed ./schema-sql entry', () => {
    const packageJson = readPackageJson();

    expect(packageJson.exports?.['./schema-sql']).toBeUndefined();
  });
});
