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

describe('importing the server text types under a types-less pg mock', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not touch pg.types at import time', async () => {
    const module = await import('../src/server-text-types');

    expect(module.serverTextTypes).toBeDefined();
    expect(module.controlTextTypes).toBeDefined();
  });

  it('returns server text for every OID at runtime without touching pg.types', async () => {
    const { serverTextTypes } = await import('../src/server-text-types');

    for (const oid of [16, 17, 20, 25, 114, 700, 1114, 1186, 3802, 999_999]) {
      expect(serverTextTypes.getTypeParser(oid, 'text')('server text')).toBe('server text');
    }
  });

  it('returns array text for the control plane and defers other OIDs to pg.types', async () => {
    const { PG_TYPES_ARRAY_OIDS, controlTextTypes } = await import('../src/server-text-types');

    expect([...PG_TYPES_ARRAY_OIDS].sort((a, b) => a - b)).toEqual(captureRegisteredArrayOids());
    for (const oid of PG_TYPES_ARRAY_OIDS) {
      expect(controlTextTypes.getTypeParser(oid, 'text')('{a,b}')).toBe('{a,b}');
    }
    expect(() => controlTextTypes.getTypeParser(25, 'text')).toThrow();
  });

  it('detects when a production array OID is missing from the driver set', async () => {
    const { PG_TYPES_ARRAY_OIDS } = await import('../src/server-text-types');
    const actual = captureRegisteredArrayOids();
    const broken = [...PG_TYPES_ARRAY_OIDS].filter((oid) => oid !== 1000).sort((a, b) => a - b);

    expect(actual).not.toEqual(broken);
  });
});
