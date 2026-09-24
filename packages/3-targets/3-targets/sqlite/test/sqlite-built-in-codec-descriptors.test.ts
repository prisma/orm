import type {
  AnyCodecDescriptorTemplate,
  CodecInstanceContext,
  CodecRef,
} from '@internal/framework-components/codec';
import {
  CaseExpr,
  CastExpr,
  ColumnRef,
  FunctionCallExpr,
  LiteralExpr,
  NullCheckExpr,
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
import { sqliteCodecDescriptorRegistry, sqliteCodecRegistry } from '../src/core/registry';

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

  it('adapts every generic SQL descriptor with identity projection and scalar-only semantics', () => {
    const expression = ColumnRef.of('records', 'value');
    const cases: ReadonlyArray<{
      descriptor: AnySqliteCodecDescriptor;
      rawDescriptor: AnyCodecDescriptorTemplate;
      typeParams?: CodecRef['typeParams'];
    }> = [
      {
        descriptor: sqliteSqlCharDescriptor,
        rawDescriptor: sqlCharDescriptor,
        typeParams: { length: 12 },
      },
      {
        descriptor: sqliteSqlVarcharDescriptor,
        rawDescriptor: sqlVarcharDescriptor,
        typeParams: { length: 120 },
      },
      { descriptor: sqliteSqlIntDescriptor, rawDescriptor: sqlIntDescriptor },
      { descriptor: sqliteSqlFloatDescriptor, rawDescriptor: sqlFloatDescriptor },
    ];

    for (const { descriptor, rawDescriptor, typeParams } of cases) {
      expect(descriptor.codecId).toBe(rawDescriptor.codecId);
      expect(descriptor.paramsSchema).toBe(rawDescriptor.paramsSchema);
      expect(descriptor.projectJson(expression, refFor(descriptor, typeParams))).toBe(expression);
    }

    expect(() =>
      sqliteSqlIntDescriptor.projectJson(expression, {
        codecId: sqliteSqlIntDescriptor.codecId,
        many: true,
      }),
    ).toThrow(/do not support stored scalar arrays/);
  });

  it("projects identity where SQLite's own JSON conversion is already canonical", () => {
    const expression = ColumnRef.of('records', 'value');
    const descriptors = [
      sqliteTextDescriptor,
      sqliteIntegerDescriptor,
      sqliteRealDescriptor,
      sqliteDatetimeDescriptor,
    ];

    for (const descriptor of descriptors) {
      expect(descriptor.projectJson(expression, refFor(descriptor))).toBe(expression);
    }
  });

  it('replaces the native conversion where it cannot carry the value', () => {
    const expression = ColumnRef.of('records', 'value');

    // SQLite's JSON functions reject a BLOB argument outright. `hex()` is
    // guarded on NULL because `hex(NULL)` is `''`, which is also the hex of an
    // empty blob — so without the guard an absent blob and an empty one would
    // be indistinguishable, and `decodeJson` accepts `''` as a valid empty one.
    expect(sqliteBlobDescriptor.projectJson(expression, refFor(sqliteBlobDescriptor))).toEqual(
      CaseExpr.of(
        [{ condition: NullCheckExpr.isNull(expression), value: LiteralExpr.of(null) }],
        FunctionCallExpr.of('hex', [expression]),
      ),
    );
    // An INTEGER reaching JSON as a number does not survive the int64 range.
    expect(sqliteBigintDescriptor.projectJson(expression, refFor(sqliteBigintDescriptor))).toEqual(
      CastExpr.as(expression, 'TEXT'),
    );
    // A document loses SQLite's JSON subtype across a derived table and would
    // embed as a string containing JSON; the retag re-applies it.
    expect(sqliteJsonDescriptor.projectJson(expression, refFor(sqliteJsonDescriptor))).toEqual(
      FunctionCallExpr.of('json', [expression]),
    );
    // The canonical JSON is the decimal text every codec of sqlite/bigint
    // carries, whichever storage class the projected expression holds.
    expect(
      sqliteBigintNumberDescriptor.projectJson(expression, refFor(sqliteBigintNumberDescriptor)),
    ).toEqual(CastExpr.as(expression, 'TEXT'));
  });

  it('keeps authored registries complete while preserving the control metadata filter boundary', () => {
    expect(Object.isFrozen(sqliteCodecDescriptorRegistry)).toBe(true);
    expect([...sqliteCodecDescriptorRegistry.values()]).toEqual(codecDescriptors);

    for (const descriptor of codecDescriptors) {
      expect(sqliteCodecDescriptorRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
      expect(sqliteCodecRegistry.descriptorFor(descriptor.codecId)).toBe(descriptor);
    }

    const filteredControlDescriptors = codecDescriptors.filter(
      (descriptor) => descriptor.renderOutputType === undefined,
    );
    expect(filteredControlDescriptors.map((descriptor) => descriptor.codecId)).toEqual(
      EXPECTED_CODEC_IDS.filter(
        (codecId) =>
          codecId !== sqlCharDescriptor.codecId && codecId !== sqlVarcharDescriptor.codecId,
      ),
    );
    expect(sqliteCodecDescriptorRegistry.descriptorFor(sqlCharDescriptor.codecId)).toBe(
      sqliteSqlCharDescriptor,
    );
    expect(sqliteCodecDescriptorRegistry.descriptorFor(sqlVarcharDescriptor.codecId)).toBe(
      sqliteSqlVarcharDescriptor,
    );
  });

  it('preserves current BLOB, bigint, real, datetime, and structured JSON behavior', () => {
    const blobCodec = sqliteBlobDescriptor.factory()(codecContext);
    expect(blobCodec.encodeJson(new Uint8Array([0x0a, 0xbc]))).toBe('0ABC');
    expect(blobCodec.decodeJson('0ABC')).toEqual(new Uint8Array([0x0a, 0xbc]));
    expect(() => blobCodec.decodeJson('0abc')).toThrow(/uppercase hexadecimal/);

    const bigintCodec = sqliteBigintDescriptor.factory()(codecContext);
    expect(bigintCodec.encodeJson(42n)).toBe('42');
    expect(bigintCodec.decodeJson('42')).toBe(42n);
    expect(bigintCodec.encodeJson(9_007_199_254_740_993n)).toBe('9007199254740993');

    const realCodec = sqliteRealDescriptor.factory()(codecContext);
    expect(realCodec.encodeJson(1.25)).toBe(1.25);
    expect(realCodec.decodeJson(1.25)).toBe(1.25);

    const datetimeCodec = sqliteDatetimeDescriptor.factory()(codecContext);
    const date = new Date('2026-07-23T12:34:56.789Z');
    expect(datetimeCodec.encodeJson(date)).toBe('2026-07-23T12:34:56.789Z');
    expect(datetimeCodec.decodeJson('2026-07-23T12:34:56.789Z')).toEqual(date);

    const jsonCodec = sqliteJsonDescriptor.factory()(codecContext);
    const value = { nested: ['value', 1, true, null] };
    expect(jsonCodec.encodeJson(value)).toEqual(value);
    expect(jsonCodec.decodeJson(value)).toEqual(value);
  });
});
