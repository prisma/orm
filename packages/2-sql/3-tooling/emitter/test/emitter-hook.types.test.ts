import type { Contract } from '@internal/contract/types';
import type { ValidationContext } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

describe('sql-target-family-hook', () => {
  it('validates types from referenced extensions', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres', 'pg'],
    };

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates type ID format regardless of namespace', () => {
    // Namespace validation removed - codecs can use any namespace
    // Only format validation remains (ns/name@version)
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'unknown/type', codecId: 'unknown/type@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres'],
    };

    // Should not throw - namespace validation removed
    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('throws error for invalid type ID format', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'invalid-format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).toThrow('invalid codec ID format');
  });

  it('validates types from loaded packs even if not in extensions', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'postgres/int4', codecId: 'postgres/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['postgres'],
    };

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with missing column type', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).toThrow('is missing codecId');
  });

  it('validates types with type ID that fails regex match', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'invalid@format', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).toThrow('invalid codec ID format');
  });

  it('validates types with empty storage', () => {
    const ir = createContract({
      storage: {
        tables: {},
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with missing storage', () => {
    const ir = createContract({});

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with storage but no tables', () => {
    const ir = createContract({
      storage: {
        // No tables property - should hit early return at line 16
      },
    });

    const ctx: ValidationContext = {};

    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types regardless of extensionIds', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const ctx: ValidationContext = {
      extensionIds: ['invalid-extension-id-without-slash'],
    };

    // Should not throw - extensionIds are not validated here
    expect(() => {
      sqlEmission.validateTypes(ir, ctx);
    }).not.toThrow();
  });

  it('validates types with undefined extensions', () => {
    const ir = {
      targetFamily: 'sql',
      storage: { tables: {} },
      extensions: undefined,
    } as unknown as Contract;

    expect(() => sqlEmission.validateTypes(ir, {})).not.toThrow();
  });
});

describe('default-literal typing', () => {
  /**
   * `getFamilyTypeAliases` returns several aliases joined into one string, so a
   * bare substring match would pass on a hit anywhere in the blob. These read
   * the `DefaultLiteralValue` declaration out of it first, and normalise
   * whitespace so a semantics-preserving reformat of the emitted source does not
   * fail the test.
   */
  function defaultLiteralValueDeclaration(): string {
    const aliases = sqlEmission.getFamilyTypeAliases?.() ?? '';
    const start = aliases.indexOf('type DefaultLiteralValue<');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = aliases.indexOf(';', start);
    expect(end).toBeGreaterThan(start);
    return aliases.slice(start, end).replace(/\s+/g, ' ');
  }

  it('resolves a literal default through the codec JSON channel, not its application type', () => {
    const declaration = defaultLiteralValueDeclaration();

    expect(declaration).toContain('CodecTypes[CodecId]["json"]');
    expect(declaration).not.toContain('CodecTypes[CodecId]["output"]');
  });

  it('keeps the emitted literal when the codec JSON channel admits it', () => {
    expect(defaultLiteralValueDeclaration()).toContain(
      'Encoded extends CodecTypes[CodecId]["json"] ? Encoded',
    );
  });
});
