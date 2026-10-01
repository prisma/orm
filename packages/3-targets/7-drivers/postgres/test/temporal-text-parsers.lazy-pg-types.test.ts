import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type RegisterTextParser = (oid: number, converter: (value: string) => unknown) => void;

function captureRegisteredArrayOids(): number[] {
  const registrations: number[] = [];
  const { init } = require('pg-types/lib/textParsers') as {
    init(register: RegisterTextParser): void;
  };

  init((oid, converter) => {
    try {
      const parsed = converter('{1,2}');
      if (Array.isArray(parsed)) {
        registrations.push(oid);
      }
    } catch {
      // Ignore non-array parsers: the comparison only cares about actual registrations
      // that accept Postgres array wire text.
    }
  });

  return registrations.sort((a, b) => a - b);
}

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
    const { PG_TYPES_ARRAY_OIDS, temporalTextTypes } = await import('../src/temporal-text-parsers');

    expect([...PG_TYPES_ARRAY_OIDS].sort((a, b) => a - b)).toEqual(captureRegisteredArrayOids());
    expect(temporalTextTypes.getTypeParser(1114, 'text')('2026-01-02 03:04:05')).toBe(
      '2026-01-02 03:04:05',
    );
    expect(() => temporalTextTypes.getTypeParser(25, 'text')).toThrow();
  });

  it('detects when a production array OID is missing from the driver set', async () => {
    const { PG_TYPES_ARRAY_OIDS } = await import('../src/temporal-text-parsers');
    const actual = captureRegisteredArrayOids();
    const broken = [...PG_TYPES_ARRAY_OIDS].filter((oid) => oid !== 1000).sort((a, b) => a - b);

    expect(actual).not.toEqual(broken);
  });
});
