import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function patternsOf(audience: 'app' | 'extension', id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

const detects = (patterns: readonly RegExp[], source: string) =>
  patterns.some((pattern) => pattern.test(source));

describe('more-codecs-refused-for-enums detection', () => {
  const patterns = patternsOf('app', 'more-codecs-refused-for-enums');

  it.each([
    ['a PSL jsonb enum', 'enum Payload {\n  @@type("pg/jsonb@1")\n  Low = "low"\n}'],
    ['a PSL timetz enum', 'enum At {\n  @@type( "pg/timetz@1" )\n  Noon = "12:00:00Z"\n}'],
    ['a PSL geometry enum', 'enum Shape {\n  @@type("pg/geometry@1")\n}'],
    [
      'a TypeScript enum on the timetz helper',
      "const At = enumType('At', timetzColumn(), member('Noon', '12:00:00Z'));",
    ],
    [
      'a TypeScript enum on the timetz helper with a precision',
      "const At = enumType('At', timetzColumn(3), member('Noon', '12:00:00Z'));",
    ],
    [
      'a TypeScript enum on the jsonb helper',
      "const P = enumType('P', jsonbColumn, member('Low', 'low'));",
    ],
    [
      'a TypeScript enum on a quoted codec id',
      "const P = enumType('P', { codecId: 'pg/jsonb@1' }, member('Low', 'low'));",
    ],
    [
      'a TypeScript enum on a backtick-quoted codec id',
      'const P = enumType(`P`, { codecId: `pg/timetz@1` }, member(`Low`, `low`));',
    ],
    [
      'a TypeScript enum on the arktype json helper',
      "const P = enumType('P', arktypeJson(schema), member('Low', 'low'));",
    ],
    [
      'a TypeScript enum on the vector helper',
      "const P = enumType('P', vector(3), member('Low', [1, 2, 3]));",
    ],
    [
      'a TypeScript enum on the native enum codec',
      "const P = enumType('P', { codecId: \"pg/enum@1\" }, member('Low', 'low'));",
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(true);
  });

  it.each([
    ['a PSL text enum', 'enum Level {\n  @@type("pg/text@1")\n  Low = "low"\n}'],
    ['a PSL json enum, refused by an earlier release', 'enum Payload {\n  @@type("pg/json@1")\n}'],
    ['a codec id of another version', 'enum Payload {\n  @@type("pg/jsonb@2")\n}'],
    ['a codec id with a longer name', 'enum At {\n  @@type("pg/timetz-x@1")\n}'],
    [
      'a jsonb column in a file with no enum',
      'const User = model({ fields: { meta: field.column(jsonbColumn) } });',
    ],
    [
      'a generated file',
      "// GENERATED FILE - DO NOT EDIT\nconst P = enumType('P', jsonbColumn, member('Low', 'low'));",
    ],
    ['a TypeScript text enum', "const P = enumType('P', textColumn, member('Low', 'low'));"],
    [
      'a name that ends in vector',
      "const P = enumType('P', textColumn, member('Low', myvector('low')));",
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });
});

describe('family-codec-templates-render-no-literals detection', () => {
  const patterns = patternsOf('extension', 'family-codec-templates-render-no-literals');

  it('finds a family codec template that renders literals', () => {
    expect(
      detects(
        patterns,
        'export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {\n  override renderValueLiteral(value: JsonValue) {\n    return renderTsLiteral(value);\n  }\n}',
      ),
    ).toBe(true);
  });

  it.each([
    [
      'a family codec template that renders no literal',
      'export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {\n  override readonly codecId = "my/text@1";\n}',
    ],
    [
      'a target codec descriptor that renders literals',
      'export class MyTextDescriptor extends PostgresCodecDescriptor<void> {\n  override renderValueLiteral(value: JsonValue) {\n    return renderTsLiteral(value);\n  }\n}',
    ],
    [
      'a renderer passed in the adapter options',
      'const d = postgresCodec(sqlTextDescriptor, { dataType: pgText, renderValueLiteral: renderTsLiteral });',
    ],
    [
      'a renderer written as an arrow function in the options',
      'class T extends CodecDescriptorTemplateImpl<void> {}\nconst d = sqliteCodec(t, { renderValueLiteral: (value) => String(value) });',
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });
});

describe('psl-enum-members-read-by-the-cast-rule detection', () => {
  const patterns = patternsOf('app', 'psl-enum-members-read-by-the-cast-rule');

  it.each([
    ['a quoted numeric member', 'enum Ratio {\n  @@type("pg/numeric@1")\n  Half = "0.5"\n}'],
    ['a quoted int8 member', 'enum Level {\n  @@type("pg/int8@1")\n  Low = "1"\n}'],
    [
      'a quoted date member',
      'enum Day {\n  @@type("pg/date-temporal@1")\n  Launch = "2024-01-01"\n}',
    ],
    ['a quoted float NaN member', 'enum F {\n  @@type("pg/float8@1")\n  Nan = "NaN"\n}'],
    [
      'a quoted SQLite datetime member',
      'enum W {\n  @@type("sqlite/datetime@1")\n  At = "2024-01-01T00:00:00.000Z"\n}',
    ],
    [
      'a quoted member written before @@type',
      'enum Ratio {\n  Half = "0.5"\n  @@type("pg/numeric@1")\n}',
    ],
    [
      'a quoted SQLite json member, which now needs the json tag',
      'enum Doc {\n  @@type("sqlite/json@1")\n  Low = "low"\n}',
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(true);
  });

  it.each([
    ['an unquoted numeric member', 'enum Ratio {\n  @@type("pg/numeric@1")\n  Half = 0.5\n}'],
    [
      'a tagged SQLite json member',
      'enum Doc {\n  @@type("sqlite/json@1")\n  Low = json`"low"`\n}',
    ],
    [
      'a tagged date member',
      'enum Day {\n  @@type("pg/date-temporal@1")\n  Launch = date`2024-01-01`\n}',
    ],
    ['a quoted text member', 'enum Level {\n  @@type("pg/text@1")\n  Low = "low"\n}'],
    [
      'a quoted uuid member, which casts from text',
      'enum U {\n  @@type("pg/uuid@1")\n  A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"\n}',
    ],
    ['a quoted SQLite text member', 'enum L {\n  @@type("sqlite/text@1")\n  Low = "low"\n}'],
    [
      'a quoted Mongo member, on a codec this change does not refuse',
      'enum L {\n  @@type("mongo/int32@1")\n  Low = "1"\n}',
    ],
    ['an enum with no @@type', 'enum Level {\n  Low = "low"\n}'],
    ['bare numeric members', 'enum Ratio {\n  @@type("pg/numeric@1")\n  Half\n}'],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });

  it.each([
    ['enum blocks', 'enum E {\n'],
    ['typed enum blocks', 'enum E {\n  @@type("pg/int4@1")\n'],
  ])('reads 400 KB of repeated unclosed %s in linear time', (_name, line) => {
    const source = line.repeat(Math.ceil(400_000 / line.length));
    const start = performance.now();
    const found = detects(patterns, source);
    expect({ found, fast: performance.now() - start < 1000 }).toEqual({ found: false, fast: true });
  });
});

describe('enum-members-compare-by-their-data-type detection', () => {
  const patterns = patternsOf('app', 'enum-members-compare-by-their-data-type');

  it.each([
    ['a PSL numeric enum', 'enum Ratio {\n  @@type("pg/numeric@1")\n  Half = 0.5\n}'],
    ['a PSL interval enum', 'enum Span {\n  @@type( "pg/interval@1" )\n  Day = "P1D"\n}'],
    ['a PSL decimal128 enum', 'enum Ratio {\n  @@type("mongo/decimal128@1")\n  Half = "0.5"\n}'],
    [
      'a TypeScript enum on the numeric helper',
      "const Ratio = enumType('Ratio', numericColumn(10, 2), member('Half', '0.50'));",
    ],
    [
      'a TypeScript enum on the interval helper',
      "const Span = enumType('Span', intervalColumn(), member('Day', 'P1D'));",
    ],
    [
      'a TypeScript enum on a quoted codec id',
      "const Ratio = enumType('Ratio', { codecId: 'mongo/decimal128@1' }, member('Half', '0.5'));",
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(true);
  });

  it.each([
    ['a PSL text enum', 'enum Level {\n  @@type("pg/text@1")\n  Low = "low"\n}'],
    ['a codec id with a longer name', 'enum Ratio {\n  @@type("pg/numeric-x@1")\n}'],
    ['a codec id of another version', 'enum Ratio {\n  @@type("pg/numeric@2")\n}'],
    [
      'a numeric column in a file with no enum',
      'const Item = model({ fields: { price: field.column(numericColumn(10, 2)) } });',
    ],
    [
      'a generated file',
      "// GENERATED FILE - DO NOT EDIT\nconst R = enumType('R', numericColumn(), member('Half', '0.5'));",
    ],
    ['a TypeScript int enum', "const L = enumType('L', int4Column, member('Low', 1));"],
    [
      'a name that ends in numericColumn',
      "const L = enumType('L', textColumn, member('Low', mynumericColumn('low')));",
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });
});

describe('enum-block-written-values detection', () => {
  const patterns = patternsOf('extension', 'enum-block-written-values');

  it.each([
    ['a read of numberTexts', 'const text = block.numberTexts?.[name];'],
    ['a readWrittenNumber hook', 'const ctx = { readWrittenNumber: ({ text }) => read(text) };'],
    [
      'a WrittenValueReading built by hand',
      "const refused: WrittenValueReading = { ok: false, message: 'no' };",
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(true);
  });

  it.each([
    ['a read of writtenValues', 'const written = block.writtenValues?.[name];'],
    [
      'the hook that replaced readWrittenNumber, which a later release removes',
      'const ctx = { readWrittenValueForCodec: ({ written }) => read(written) };',
    ],
    ['a longer name', 'const t = block.numberTextsByKey;'],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });
});

describe('target-codec-adapters-take-a-factory detection', () => {
  const patterns = patternsOf('extension', 'target-codec-adapters-take-a-factory');

  it.each([
    [
      'an adapter without a factory',
      'export const d = postgresCodec(sqlTextDescriptor, {\n  dataType: pgText,\n  jsonProjection: identityJsonProjection,\n});',
    ],
    [
      'a factory that takes the parameters second',
      'export const d = postgresCodec(sqlCharDescriptor, {\n  dataType: pgChar,\n  jsonProjection: unpaddedCharJsonProjection,\n  factory: (descriptor, params) => () => new PgCharCodec(descriptor, params.length),\n});',
    ],
    [
      'a factory that takes only the descriptor',
      'sqliteCodec(sqlIntDescriptor, { dataType: sqliteInteger, jsonProjection, factory: (descriptor) => () => new MyIntCodec(descriptor) })',
    ],
    [
      'renderTypes',
      'sqliteCodec(sqlCharDescriptor, { dataType: sqliteCharacter, jsonProjection, renderTypes: false })',
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(true);
  });

  it.each([
    [
      'a factory that takes the data type',
      'export const d = postgresCodec(sqlIntDescriptor, {\n  dataType: pgInt4,\n  renderValueLiteral: renderTsLiteral,\n  jsonProjection: identityJsonProjection,\n  factory: (descriptor, dataType) => () => new PgIntCodec(descriptor, dataType),\n});',
    ],
    [
      'a factory that takes the data type and the parameters',
      'sqliteCodec(sqlCharDescriptor, {\n  dataType: sqliteCharacter,\n  jsonProjection: (expression) => expression,\n  factory: (descriptor, dataType, params) => () => new SqlCharCodec(descriptor, dataType, params),\n})',
    ],
    [
      'a factory listed before a projection method',
      'sqliteCodec(genericDescriptor, {\n  dataType: fixtureType,\n  factory: (descriptor, type, params) => () => new VectorCodec(descriptor, type, params.length),\n  jsonProjection(expression, params) {\n    return expression;\n  },\n})',
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(patterns, source)).toBe(false);
  });
});
