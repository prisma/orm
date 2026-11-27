import { afterEach, beforeEach, expect, type MockInstance, vi } from 'vitest';

/**
 * Makes `String.prototype.localeCompare` collate as on a Danish machine, where "aa" sorts after
 * "z", for every test in the enclosing `describe`.
 */
export function collateAsDanishInEachTest(): void {
  const danish = new Intl.Collator('da');
  let localeCompare: MockInstance<typeof String.prototype.localeCompare> | undefined;

  beforeEach(() => {
    expect(danish.compare('sha256:aa', 'sha256:b0')).toBeGreaterThan(0);
    localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      that: string,
    ) {
      return danish.compare(this, that);
    });
  });

  afterEach(() => {
    localeCompare?.mockRestore();
  });
}
