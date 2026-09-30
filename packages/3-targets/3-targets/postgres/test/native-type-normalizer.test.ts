import { describe, expect, it } from 'vitest';
import { normalizeSchemaNativeType } from '../src/core/native-type-normalizer';

describe('normalizeSchemaNativeType', () => {
  it('names a type as introspection reports it, whichever PostgreSQL name it is written under', () => {
    const names: Record<string, string> = {
      char: 'character',
      'char(3)': 'character(3)',
      'bpchar(3)': 'character(3)',
      'varchar(10)': 'character varying(10)',
      'varbit(5)': 'bit varying(5)',
      int: 'int4',
      integer: 'int4',
      smallint: 'int2',
      bigint: 'int8',
      real: 'float4',
      'double precision': 'float8',
      float: 'float8',
      'float(24)': 'float(24)',
      boolean: 'bool',
      'decimal(10,2)': 'numeric(10,2)',
      'timestamp with time zone': 'timestamptz',
      'timestamp(3) with time zone': 'timestamptz(3)',
      'time(6) with time zone': 'timetz(6)',
      'timestamp(3) without time zone': 'timestamp(3)',
      'time without time zone': 'time',
      'integer[]': 'int4[]',
      'varchar(10)[]': 'character varying(10)[]',
      uuid: 'uuid',
      'audit.AuditAction': 'audit.AuditAction',
    };
    expect(
      Object.fromEntries(Object.keys(names).map((name) => [name, normalizeSchemaNativeType(name)])),
    ).toEqual(names);
  });
});
