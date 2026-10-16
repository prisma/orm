import type {
  AnyCodecDescriptorTemplate,
  CodecInstanceContext,
  CodecRef,
  DataType,
} from '@internal/framework-components/codec';
import {
  BinaryExpr,
  CaseExpr,
  CastExpr,
  ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlVarcharDescriptor,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import type { AnySqliteCodecDescriptor } from '../src/core/codec-descriptor';
import {
  codecDescriptors,
  sqliteBigintDescriptor,
  sqliteBigintNumberDescriptor,
  sqliteBlobDescriptor,
  sqliteDatetimeDescriptor,
  sqliteIntegerDescriptor,
  sqliteJsonDescriptor,
  sqliteRealDescriptor,
  sqliteSqlCharDescriptor,
  sqliteSqlFloatDescriptor,
  sqliteSqlIntDescriptor,
  sqliteSqlVarcharDescriptor,
  sqliteTextDescriptor,
} from '../src/core/codecs';
import {
  sqliteCharacter,
  sqliteCharacterVarying,
  sqliteInteger,
  sqliteReal,
} from '../src/core/data-types';
import { sqliteCodecDescriptorRegistry, sqliteCodecRegistry } from '../src/core/registry';
import { fromContractJson, toContractJson } from './contract-json';

const EXPECTED_CODEC_IDS = [
  'sql/char@1',
  'sql/varchar@1',
  'sql/int@1',
  'sql/float@1',
  'sqlite/text@1',
  'sqlite/integer@1',
  'sqlite/real@1',
  'sqlite/blob@1',
  'sqlite/datetime@1',
  'sqlite/json@1',
  'sqlite/bigint@1',
  'sqlite/bigintnumber@1',
] as const;

const refFor = (
  descriptor: AnySqliteCodecDescriptor,
  typeParams?: CodecRef['typeParams'],
): CodecRef => ({
  codecId: descriptor.codecId,
  ...ifDefined('typeParams', typeParams),
});

const codecContext: CodecInstanceContext = { name: 'test' };

describe('SQLite built-in codec descriptors', () => {
  it('keeps the complete canonical order with only target descriptors', () => {
    expect(codecDescriptors.map((descriptor) => descriptor.codecId)).toEqual(EXPECTED_CODEC_IDS);
    expect(
      codecDescriptors.every((descriptor) => descriptor.descriptorKind === 'sqlite-codec'),
    ).toBe(true);

    for (const rawDescriptor of [
      sqlCharDescriptor,
      sqlVarcharDescriptor,
      sqlIntDescriptor,
      sqlFloatDescriptor,
    ]) {
      expect(codecDescriptors).not.toContain(rawDescriptor);
    }
  });

  it('projects sql/char@1 without trailing spaces, as its decode reads a flat value', () => {
    const expression = ColumnRef.of('records', 'value');
    expect(
      sqliteSqlCharDescriptor.projectJson(
        expression,
        refFor(sqliteSqlCharDescriptor, { length: 12 }),
      ),
    ).toEqual(FunctionCallExpr.of('rtrim', [expression, LiteralExpr.of(' ')]));
    expect({
      dataType: sqliteSqlCharDescriptor.dataType,
      paramsSchema: sqliteSqlCharDescriptor.paramsSchema,
    }).toEqual({ dataType: sqliteCharacter.id, paramsSchema: sqliteCharacter.params });
  });

  it('adapts the other generic SQL descriptors with identity projection and scalar-only semantics', () => {
    const expression = ColumnRef.of('records', 'value');
    const cases: ReadonlyArray<{
      descriptor: AnySqliteCodecDescriptor;
      rawDescriptor: AnyCodecDescriptorTemplate;
      dataType: DataType;
      typeParams?: CodecRef['typeParams'];
    }> = [
      {
        descriptor: sqliteSqlVarcharDescriptor,
        rawDescriptor: sqlVarcharDescriptor,
        dataType: sqliteCharacterVarying,
        typeParams: { length: 120 },
      },
    ];

    for (const { descriptor, rawDescriptor, dataType, typeParams } of cases) {
      expect(descriptor.codecId).toBe(rawDescriptor.codecId);
      expect(descriptor.dataType).toBe(dataType.id);
      expect(descriptor.paramsSchema).toBe(dataType.params);
      expect(descriptor.projectJson(expression, refFor(descriptor, typeParams))).toBe(expression);
    }

    expect(sqliteSqlIntDescriptor.codecId).toBe(sqlIntDescriptor.codecId);
    expect(sqliteSqlIntDescriptor.dataType).toBe(sqliteInteger.id);
    expect(sqliteSqlIntDescriptor.paramsSchema).toBeUndefined();

    expect(() =>
      sqliteSqlIntDescriptor.projectJson(expression, {
        codecId: sqliteSqlIntDescriptor.codecId,
        many: true,
      }),
    ).toThrow(/do not support stored scalar arrays/);
  });

  it("projects identity where SQLite's own JSON conversion is already canonical", () => {
    const expression = ColumnRef.of('records', 'value');
    const descriptors = [sqliteTextDescriptor, sqliteDatetimeDescriptor, sqliteJsonDescriptor];

    for (const descriptor of descriptors) {
      expect(descriptor.projectJson(expression, refFor(descriptor))).toBe(expression);
    }
  });

  it('replaces the native conversion where it cannot carry the value', () => {
    const expression = ColumnRef.of('records', 'value');

    // SQLite's JSON functions reject a BLOB argument outright. A blob is carried as its hex text inside a
    // one-element array, which no row holds, so text in a BLOB column stays text. NULL and any other
    // value pass through as themselves.
    expect(sqliteBlobDescriptor.projectJson(expression, refFor(sqliteBlobDescriptor))).toEqual(
      CaseExpr.of(
        [
          {
            condition: BinaryExpr.eq(
              FunctionCallExpr.of('typeof', [expression]),
              LiteralExpr.of('blob'),
            ),
            value: FunctionCallExpr.of('json_array', [FunctionCallExpr.of('hex', [expression])]),
          },
        ],
        expression,
      ),
    );
    // SQLite writes an infinity in JSON as 9.0e+999; both float codecs write the text their toDataTypeValue writes.
    const infinityAsText = CaseExpr.of(
      [
        {
          condition: BinaryExpr.eq(expression, LiteralExpr.of(Number.POSITIVE_INFINITY)),
          value: LiteralExpr.of('Infinity'),
        },
        {
          condition: BinaryExpr.eq(expression, LiteralExpr.of(Number.NEGATIVE_INFINITY)),
          value: LiteralExpr.of('-Infinity'),
        },
      ],
      expression,
    );
    expect({
      real: sqliteRealDescriptor.projectJson(expression, refFor(sqliteRealDescriptor)),
      sqlFloat: sqliteSqlFloatDescriptor.projectJson(expression, refFor(sqliteSqlFloatDescriptor)),
    }).toEqual({ real: infinityAsText, sqlFloat: infinityAsText });
    expect({
      dataType: sqliteSqlFloatDescriptor.dataType,
      paramsSchema: sqliteSqlFloatDescriptor.paramsSchema,
    }).toEqual({ dataType: sqliteReal.id, paramsSchema: sqliteReal.params });
    // An INTEGER reaching JSON as a number does not survive the int64 range.
    expect(sqliteBigintDescriptor.projectJson(expression, refFor(sqliteBigintDescriptor))).toEqual(
      CastExpr.as(expression, 'TEXT'),
    );
    // The canonical JSON is the decimal text every codec of sqlite/integer
    // carries, whichever storage class the projected expression holds.
    for (const descriptor of [
      sqliteIntegerDescriptor,
      sqliteSqlIntDescriptor,
      sqliteBigintNumberDescriptor,
    ]) {
      expect(descriptor.projectJson(expression, refFor(descriptor))).toEqual(
        CastExpr.as(expression, 'TEXT'),
      );
    }
  });

  it('keeps authored registries complete, with no codec rendering a named TypeScript type', () => {
    expect(Object.isFrozen(sqliteCodecDescriptorRegistry)).toBe(true);
    expect([...sqliteCodecDescriptorRegistry.values()]).toEqual(codecDescriptors);

    for (const descriptor of codecDescriptors) {
      expect(sqliteCodecDescriptorRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
      expect(sqliteCodecRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
    }

    expect(
      codecDescriptors
        .filter((descriptor) => descriptor.renderOutputType !== undefined)
        .map((descriptor) => descriptor.codecId),
    ).toEqual([]);
    expect(sqliteCodecDescriptorRegistry.descriptorFor(sqlCharDescriptor.codecId)).toBe(
      sqliteSqlCharDescriptor,
    );
    expect(sqliteCodecDescriptorRegistry.descriptorFor(sqlVarcharDescriptor.codecId)).toBe(
      sqliteSqlVarcharDescriptor,
    );
  });

  it('writes and reads each data type’s canonical form', () => {
    const blobCodec = sqliteBlobDescriptor.factory()(codecContext);
    expect(toContractJson(blobCodec, new Uint8Array([0x0a, 0xbc]))).toBe('0ABC');
    expect(fromContractJson(blobCodec, '0ABC')).toEqual(new Uint8Array([0x0a, 0xbc]));
    expect(() => fromContractJson(blobCodec, '0abc')).toThrow(
      'sqlite/blob JSON value must be uppercase hexadecimal text',
    );

    const bigintCodec = sqliteBigintDescriptor.factory()(codecContext);
    expect(toContractJson(bigintCodec, 42n)).toBe('42');
    expect(fromContractJson(bigintCodec, '42')).toBe(42n);
    expect(toContractJson(bigintCodec, 9_007_199_254_740_993n)).toBe('9007199254740993');

    const realCodec = sqliteRealDescriptor.factory()(codecContext);
    expect(toContractJson(realCodec, 1.25)).toBe(1.25);
    expect(fromContractJson(realCodec, 1.25)).toBe(1.25);

    const datetimeCodec = sqliteDatetimeDescriptor.factory()(codecContext);
    const date = new Date('2026-07-23T12:34:56.789Z');
    expect(toContractJson(datetimeCodec, date)).toBe('2026-07-23T12:34:56.789Z');
    expect(fromContractJson(datetimeCodec, '2026-07-23T12:34:56.789Z')).toEqual(date);

    const jsonCodec = sqliteJsonDescriptor.factory()(codecContext);
    const value = { nested: ['value', 1, true, null] };
    expect(toContractJson(jsonCodec, value)).toBe('{"nested":["value",1,true,null]}');
    expect(fromContractJson(jsonCodec, '{"nested":["value",1,true,null]}')).toEqual(value);
  });
});
