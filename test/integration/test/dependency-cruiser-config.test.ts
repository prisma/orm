import { describe, expect, it } from 'vitest';
// @ts-expect-error -- JS config module is validated via a narrowed runtime shape in this test.
import depCruiseConfigUntyped from '../../../dependency-cruiser.config.mjs';

type DependencyCruiseConfig = {
  forbidden: Array<{
    from?: { path?: string };
    to?: { path?: string };
  }>;
};

const depCruiseConfig = depCruiseConfigUntyped as DependencyCruiseConfig;

function regexesContaining(fragment: string): RegExp[] {
  const patterns = depCruiseConfig.forbidden
    .flatMap((rule) => [rule.from?.path, rule.to?.path])
    .filter((path): path is string => typeof path === 'string')
    .filter((path) => path.includes(fragment));

  return patterns.map((pattern) => new RegExp(pattern));
}

describe('dependency-cruiser config glob normalization', () => {
  it('matches file-specific glob targets', () => {
    const target = 'packages/2-sql-family/9-family/src/exports/control.ts';
    const regexes = regexesContaining(target);

    expect(regexes.length).toBeGreaterThan(0);
    expect(regexes.every((regex) => regex.test(target))).toBe(true);
  });

  it('matches directory globs against child files', () => {
    const fragment = 'packages/3-targets/postgres/9-facade/src/exports';
    const target = 'packages/3-targets/postgres/9-facade/src/exports/runtime.ts';
    const regexes = regexesContaining(fragment);

    expect(regexes.length).toBeGreaterThan(0);
    expect(regexes.some((regex) => regex.test(target))).toBe(true);
  });
});
