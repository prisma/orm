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
        String: { constructorPath: ['String'], args: [] },
        Boolean: { constructorPath: ['Boolean'], args: [] },
        Int: { constructorPath: ['Int'], args: [] },
        BigInt: { constructorPath: ['BigInt'], args: [] },
        Float: { constructorPath: ['Float'], args: [] },
        Decimal: { constructorPath: ['Numeric'], args: [65, 30] },
        DateTime: { constructorPath: ['TimestampJsDate'], args: [3] },
        Json: { constructorPath: ['Jsonb'], args: [] },
        Bytes: { constructorPath: ['Bytes'], args: [] },
      },
      nativeTypes: {
        Text: { constructorPath: ['String'], args: [] },
        VarChar: { constructorPath: ['VarChar'], args: [] },
        Char: { constructorPath: ['Char'], args: [1] },
        Uuid: { constructorPath: ['Uuid'], args: [] },
        Inet: { constructorPath: ['Inet'], args: [] },
        Boolean: { constructorPath: ['Boolean'], args: [] },
        Integer: { constructorPath: ['Int'], args: [] },
        SmallInt: { constructorPath: ['SmallInt'], args: [] },
        BigInt: { constructorPath: ['BigInt'], args: [] },
        Real: { constructorPath: ['Real'], args: [] },
        DoublePrecision: { constructorPath: ['Float'], args: [] },
        Decimal: { constructorPath: ['Numeric'], args: [] },
        Timestamp: { constructorPath: ['TimestampJsDate'], args: [] },
        Timestamptz: { constructorPath: ['TimestamptzJsDate'], args: [] },
        Date: { constructorPath: ['DateString'], args: [] },
        Time: { constructorPath: ['TimeString'], args: [] },
        Timetz: { constructorPath: ['Timetz'], args: [] },
        Json: { constructorPath: ['Json'], args: [] },
        JsonB: { constructorPath: ['Jsonb'], args: [] },
        ByteA: { constructorPath: ['Bytes'], args: [] },
        Bit: { constructorPath: ['Bit'], args: [1] },
        VarBit: { constructorPath: ['VarBit'], args: [] },
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
      Text: 'String',
      Integer: 'Int',
      DoublePrecision: 'Float',
      Decimal: 'Numeric',
      Timestamp: 'TimestampJsDate',
      Timestamptz: 'TimestamptzJsDate',
      Date: 'DateString',
      Time: 'TimeString',
      JsonB: 'Jsonb',
      ByteA: 'Bytes',
      Citext: 'citext.Citext',
    });
    expect(postgresTargetDescriptorMeta.authoring.renamedTypeConstructors).toBe(
      prisma7PostgresRenamedNativeTypes,
    );
  });
});
