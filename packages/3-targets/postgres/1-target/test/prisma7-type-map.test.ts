import { describe, expect, it } from 'vitest';
import { prisma7PostgresTypeMap, prisma7PostgresTypes } from '../src/core/prisma7-type-map';

describe('the Prisma 7 type table', () => {
  it('writes each Prisma 7 type with the constructor marked inferred for its data type and every parameter Prisma 7 gives it', () => {
    expect(prisma7PostgresTypeMap).toEqual({
      scalars: {
        String: { constructorName: 'String', args: [] },
        Boolean: { constructorName: 'Boolean', args: [] },
        Int: { constructorName: 'Int', args: [] },
        BigInt: { constructorName: 'BigInt', args: [] },
        Float: { constructorName: 'Float', args: [] },
        Decimal: { constructorName: 'Numeric', args: [65, 30] },
        DateTime: { constructorName: 'TimestampJsDate', args: [3] },
        Json: { constructorName: 'Jsonb', args: [] },
        Bytes: { constructorName: 'Bytes', args: [] },
      },
      nativeTypes: {
        Text: { constructorName: 'String', args: [] },
        VarChar: { constructorName: 'VarChar', args: [] },
        Char: { constructorName: 'Char', args: [1] },
        Uuid: { constructorName: 'Uuid', args: [] },
        Inet: { constructorName: 'Inet', args: [] },
        Boolean: { constructorName: 'Boolean', args: [] },
        Integer: { constructorName: 'Int', args: [] },
        SmallInt: { constructorName: 'SmallInt', args: [] },
        BigInt: { constructorName: 'BigInt', args: [] },
        Real: { constructorName: 'Real', args: [] },
        DoublePrecision: { constructorName: 'Float', args: [] },
        Decimal: { constructorName: 'Numeric', args: [] },
        Timestamp: { constructorName: 'TimestampJsDate', args: [] },
        Timestamptz: { constructorName: 'TimestamptzJsDate', args: [] },
        Date: { constructorName: 'DateString', args: [] },
        Time: { constructorName: 'TimeString', args: [] },
        Timetz: { constructorName: 'Timetz', args: [] },
        Json: { constructorName: 'Json', args: [] },
        JsonB: { constructorName: 'Jsonb', args: [] },
        ByteA: { constructorName: 'Bytes', args: [] },
        Bit: { constructorName: 'Bit', args: [1] },
        VarBit: { constructorName: 'VarBit', args: [] },
        Xml: { constructorName: 'Xml', args: [] },
        Oid: { constructorName: 'Oid', args: [] },
        Money: { constructorName: 'Money', args: [] },
      },
    });
  });

  it('names the data type and parameters Prisma 7 creates for each type', () => {
    expect({
      DateTime: prisma7PostgresTypes.scalars.DateTime,
      Decimal: prisma7PostgresTypes.scalars.Decimal,
      Char: prisma7PostgresTypes.nativeTypes.Char,
      Timetz: prisma7PostgresTypes.nativeTypes.Timetz,
    }).toEqual({
      DateTime: { dataType: 'pg/timestamp', params: { precision: 3 } },
      Decimal: { dataType: 'pg/numeric', params: { precision: 65, scale: 30 } },
      Char: { dataType: 'pg/char', params: { length: 1 } },
      Timetz: { dataType: 'pg/timetz', params: {} },
    });
  });
});
