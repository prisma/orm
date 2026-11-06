import { describe, expect, it } from 'vitest';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import {
  prisma7PostgresRenamedNativeTypes,
  prisma7PostgresTypeMap,
  prisma7PostgresTypes,
} from '../src/core/prisma7-type-map';

describe('the Prisma 7 type table', () => {
  it('writes each Prisma 7 type with the constructor marked inferred for its data type and every parameter Prisma 7 gives it', () => {
    expect(prisma7PostgresTypeMap).toEqual({
      scalars: {
        String: { constructorPath: ['Text'], args: [] },
        Boolean: { constructorPath: ['Bool'], args: [] },
        Int: { constructorPath: ['Int4'], args: [] },
        BigInt: { constructorPath: ['Int8BigInt'], args: [] },
        Float: { constructorPath: ['Float8'], args: [] },
        Decimal: { constructorPath: ['NumericString'], args: [65, 30] },
        DateTime: { constructorPath: ['TimestampJsDate'], args: [3] },
        Json: { constructorPath: ['Jsonb'], args: [] },
        Bytes: { constructorPath: ['Bytea'], args: [] },
      },
      nativeTypes: {
        Text: { constructorPath: ['Text'], args: [] },
        VarChar: { constructorPath: ['Varchar'], args: [] },
        Char: { constructorPath: ['Char'], args: [1] },
        Uuid: { constructorPath: ['Uuid'], args: [] },
        Inet: { constructorPath: ['Inet'], args: [] },
        Boolean: { constructorPath: ['Bool'], args: [] },
        Integer: { constructorPath: ['Int4'], args: [] },
        SmallInt: { constructorPath: ['Int2'], args: [] },
        BigInt: { constructorPath: ['Int8BigInt'], args: [] },
        Real: { constructorPath: ['Float4'], args: [] },
        DoublePrecision: { constructorPath: ['Float8'], args: [] },
        Decimal: { constructorPath: ['NumericString'], args: [] },
        Timestamp: { constructorPath: ['TimestampJsDate'], args: [] },
        Timestamptz: { constructorPath: ['TimestamptzJsDate'], args: [] },
        Date: { constructorPath: ['DateString'], args: [] },
        Time: { constructorPath: ['TimeString'], args: [] },
        Timetz: { constructorPath: ['Timetz'], args: [] },
        Json: { constructorPath: ['Json'], args: [] },
        JsonB: { constructorPath: ['Jsonb'], args: [] },
        ByteA: { constructorPath: ['Bytea'], args: [] },
        Bit: { constructorPath: ['Bit'], args: [1] },
        VarBit: { constructorPath: ['Varbit'], args: [] },
        Xml: { constructorPath: ['Xml'], args: [] },
        Oid: { constructorPath: ['Oid'], args: [] },
        Money: { constructorPath: ['Money'], args: [] },
      },
      extensionNativeTypes: {
        Citext: { constructorPath: ['citext', 'Citext'], args: [], extension: 'citext' },
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

  it('contributes the native types whose Prisma 8 constructor has another name', () => {
    expect(prisma7PostgresRenamedNativeTypes).toEqual({
      VarChar: 'Varchar',
      Boolean: 'Bool',
      Integer: 'Int4',
      SmallInt: 'Int2',
      BigInt: 'Int8BigInt',
      Real: 'Float4',
      DoublePrecision: 'Float8',
      Decimal: 'NumericString',
      Timestamp: 'TimestampJsDate',
      Timestamptz: 'TimestamptzJsDate',
      Date: 'DateString',
      Time: 'TimeString',
      JsonB: 'Jsonb',
      ByteA: 'Bytea',
      VarBit: 'Varbit',
      Citext: 'citext.Citext',
    });
    expect(postgresTargetDescriptorMeta.authoring.renamedTypeConstructors).toBe(
      prisma7PostgresRenamedNativeTypes,
    );
  });
});
