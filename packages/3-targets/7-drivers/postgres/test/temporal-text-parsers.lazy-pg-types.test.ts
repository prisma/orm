import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({ default: {}, Client: class {}, Pool: class {} }));

describe('importing the temporal text parsers under a types-less pg mock', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not touch pg.types at import time', async () => {
    const module = await import('../src/temporal-text-parsers');

    expect(module.temporalTextTypes).toBeDefined();
  });

  it('defers the failure to the first parser lookup, where a real pg would be present', async () => {
    const { temporalTextTypes } = await import('../src/temporal-text-parsers');

    expect(temporalTextTypes.getTypeParser(1114, 'text')('2026-01-02 03:04:05')).toBe(
      '2026-01-02 03:04:05',
    );
    expect(() => temporalTextTypes.getTypeParser(25, 'text')).toThrow();
  });
});
