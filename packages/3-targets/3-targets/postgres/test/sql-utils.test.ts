import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  escapeLiteral,
  qualifyName,
  quoteIdentifier,
  quoteQualifiedName,
  validateEnumValueLength,
} from '../src/core/sql-utils';

function catchStructured(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected function to throw');
}

describe('quoteIdentifier', () => {
  it('quotes simple identifiers', () => {
    expect(quoteIdentifier('user')).toBe('"user"');
    expect(quoteIdentifier('table_name')).toBe('"table_name"');
  });

  it('escapes double quotes by doubling them', () => {
    expect(quoteIdentifier('table"name')).toBe('"table""name"');
    expect(quoteIdentifier('a"b"c')).toBe('"a""b""c"');
  });

  it('handles special characters safely', () => {
    expect(quoteIdentifier("table'name")).toBe('"table\'name"');
    expect(quoteIdentifier('table\\name')).toBe('"table\\name"');
    expect(quoteIdentifier('table\nname')).toBe('"table\nname"');
    expect(quoteIdentifier('table;DROP TABLE users;--')).toBe('"table;DROP TABLE users;--"');
  });

  it('throws CONTRACT.IDENTIFIER_INVALID for null bytes', () => {
    const error = catchStructured(() => quoteIdentifier('table\0name'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      message: 'Identifier cannot contain null bytes',
    });
  });

  it('throws CONTRACT.IDENTIFIER_INVALID for empty identifiers', () => {
    const error = catchStructured(() => quoteIdentifier(''));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      message: 'Identifier cannot be empty',
    });
  });

  it('includes sanitized value in error meta', () => {
    const error = catchStructured(() => quoteIdentifier('table\0name'));
    expect(error).toMatchObject({
      meta: { value: 'table\\0name', context: 'identifier' },
    });
  });

  it('warns when identifier exceeds length limit', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const identifier = 'a'.repeat(64);

    const result = quoteIdentifier(identifier);

    expect(result).toBe(`"${identifier}"`);
    expect(warnSpy).toHaveBeenCalledWith(
      `Identifier "${identifier.slice(0, 20)}..." exceeds PostgreSQL's 63-byte limit and will be truncated`,
    );

    warnSpy.mockRestore();
  });

  it('warns for a multibyte identifier over 63 bytes but under 63 characters', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A Cyrillic column name: 50 characters, 96 UTF-8 bytes. Postgres measures
    // the byte length, so it stores this name truncated to 63 bytes — the
    // declared object can then never be matched against the live one.
    const identifier = 'электронная_почта_адрес_подтверждена_пользователем';

    const result = quoteIdentifier(identifier);

    expect(identifier.length).toBeLessThanOrEqual(63);
    expect(new TextEncoder().encode(identifier).length).toBeGreaterThan(63);
    expect(result).toBe(`"${identifier}"`);
    expect(warnSpy).toHaveBeenCalledWith(
      `Identifier "${identifier.slice(0, 20)}..." exceeds PostgreSQL's 63-byte limit and will be truncated`,
    );

    warnSpy.mockRestore();
  });

  it('stays silent for a multibyte identifier that is exactly 63 bytes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // '€' (U+20AC) is 3 UTF-8 bytes: 21 characters = 63 bytes, exactly at the limit.
    const identifier = '€'.repeat(21);

    const result = quoteIdentifier(identifier);

    expect(new TextEncoder().encode(identifier).length).toBe(63);
    expect(result).toBe(`"${identifier}"`);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('escapeLiteral', () => {
  it('escapes simple strings', () => {
    expect(escapeLiteral('hello')).toBe('hello');
    expect(escapeLiteral('user@example.com')).toBe('user@example.com');
  });

  it('escapes single quotes by doubling them', () => {
    expect(escapeLiteral("it's")).toBe("it''s");
    expect(escapeLiteral("a'b'c")).toBe("a''b''c");
  });

  it('handles potential SQL injection patterns safely', () => {
    expect(escapeLiteral("'; DROP TABLE users; --")).toBe("''; DROP TABLE users; --");
    expect(escapeLiteral("1' OR '1'='1")).toBe("1'' OR ''1''=''1");
    expect(escapeLiteral("admin'--")).toBe("admin''--");
  });

  it('preserves backslashes (standard_conforming_strings=on)', () => {
    expect(escapeLiteral('path\\to\\file')).toBe('path\\to\\file');
    expect(escapeLiteral("value\\'test")).toBe("value\\''test");
  });

  it('handles newlines and other whitespace', () => {
    expect(escapeLiteral('line1\nline2')).toBe('line1\nline2');
    expect(escapeLiteral('col1\tcol2')).toBe('col1\tcol2');
  });

  it('throws CONTRACT.IDENTIFIER_INVALID for null bytes', () => {
    const error = catchStructured(() => escapeLiteral('value\0test'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      message: 'Literal value cannot contain null bytes',
    });
  });

  it('includes sanitized value in error meta', () => {
    const error = catchStructured(() => escapeLiteral('value\0test'));
    expect(error).toMatchObject({
      meta: { value: 'value\\0test', context: 'literal' },
    });
  });
});

describe('qualifyName', () => {
  it('builds schema-qualified names', () => {
    expect(qualifyName('public', 'user')).toBe('"public"."user"');
    expect(qualifyName('my_schema', 'my_table')).toBe('"my_schema"."my_table"');
  });

  it('handles special characters in both parts', () => {
    expect(qualifyName('schema"name', 'table"name')).toBe('"schema""name"."table""name"');
  });

  it('propagates null byte errors', () => {
    expect(() => qualifyName('schema\0name', 'table')).toThrow(
      'Identifier cannot contain null bytes',
    );
    expect(() => qualifyName('schema', 'table\0name')).toThrow(
      'Identifier cannot contain null bytes',
    );
    for (const [schemaName, objectName] of [
      ['schema\0name', 'table'],
      ['schema', 'table\0name'],
    ] as const) {
      const error = catchStructured(() => qualifyName(schemaName, objectName));
      expect(isStructuredError(error)).toBe(true);
      expect(error).toMatchObject({
        code: 'CONTRACT.IDENTIFIER_INVALID',
        meta: { context: 'identifier' },
      });
    }
  });
});

describe('quoteQualifiedName', () => {
  it('quotes an unqualified name as a single identifier', () => {
    expect(quoteQualifiedName('order_status')).toBe('"order_status"');
  });

  it('quotes each segment of a dot-qualified name', () => {
    expect(quoteQualifiedName('auth.aal_level')).toBe('"auth"."aal_level"');
  });

  it('round-trips a single segment to exactly quoteIdentifier', () => {
    expect(quoteQualifiedName('Status_v2')).toBe(quoteIdentifier('Status_v2'));
  });

  it('escapes embedded double quotes per segment', () => {
    expect(quoteQualifiedName('sch"ema.ta"ble')).toBe('"sch""ema"."ta""ble"');
  });
});

describe('enum value security scenarios', () => {
  it('handles enum values with quotes safely', () => {
    const values = ["it's", "don't", "can't"];
    const escaped = values.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe("'it''s', 'don''t', 'can''t'");
  });

  it('handles enum values with SQL injection attempts', () => {
    const maliciousValues = ["active'); DROP TABLE users; --", "inactive' OR '1'='1", "pending\\'"];

    const escaped = maliciousValues.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe(
      "'active''); DROP TABLE users; --', 'inactive'' OR ''1''=''1', 'pending\\'''",
    );
  });

  it('rejects enum values with null bytes', () => {
    const maliciousValue = 'active\0';
    expect(() => escapeLiteral(maliciousValue)).toThrow('Literal value cannot contain null bytes');
    const error = catchStructured(() => escapeLiteral(maliciousValue));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      meta: { context: 'literal' },
    });
  });

  it('handles unicode enum values safely', () => {
    const unicodeValues = ['日本語', 'émoji 🎉', 'Ελληνικά'];
    const escaped = unicodeValues.map((v) => `'${escapeLiteral(v)}'`).join(', ');
    expect(escaped).toBe("'日本語', 'émoji 🎉', 'Ελληνικά'");
  });
});

describe('type name security scenarios', () => {
  it('handles type names with special characters', () => {
    expect(quoteIdentifier('Status_v2')).toBe('"Status_v2"');
    expect(quoteIdentifier('user-status')).toBe('"user-status"');
  });

  it('handles schema names with injection attempts', () => {
    const maliciousSchema = 'public"; DROP SCHEMA public; --';
    expect(quoteIdentifier(maliciousSchema)).toBe('"public""; DROP SCHEMA public; --"');
  });
});

describe('validateEnumValueLength', () => {
  it('accepts values within the limit', () => {
    expect(() => validateEnumValueLength('ok', 'Status')).not.toThrow();
  });

  it('throws CONTRACT.IDENTIFIER_INVALID when value exceeds the limit', () => {
    const longValue = 'a'.repeat(64);
    const error = catchStructured(() => validateEnumValueLength(longValue, 'Status'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      meta: { value: longValue, context: 'enum-label' },
    });
  });

  it('measures the limit in UTF-8 bytes, not characters — a 63-byte multibyte label passes', () => {
    // '€' (U+20AC) is 3 UTF-8 bytes: 21 chars = 63 bytes, exactly at the limit.
    const label = '€'.repeat(21);
    expect(label.length).toBe(21);
    expect(() => validateEnumValueLength(label, 'Status')).not.toThrow();
  });

  it('throws for a multibyte label whose byte length exceeds 63 despite a short character count', () => {
    // 22 chars = 66 UTF-8 bytes — under the 63-CHARACTER count, over the 63-BYTE limit.
    const label = '€'.repeat(22);
    expect(label.length).toBe(22);
    expect(() => validateEnumValueLength(label, 'Status')).toThrow('byte label limit');
    const error = catchStructured(() => validateEnumValueLength(label, 'Status'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      meta: { value: label, context: 'enum-label' },
    });
  });
});
