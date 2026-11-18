import fc from 'fast-check';

export interface ScalarType {
  readonly psl: string;
  readonly values: fc.Arbitrary<unknown>;
  readonly equatable: boolean;
  readonly distinct?: (ordinal: number) => unknown;
  readonly summable?: boolean;
}

export const existingOrdinals = fc.integer({ min: 1, max: 6 });
export const unusedOrdinals = fc.integer({ min: 20, max: 59 });

function key(psl: string, distinct: (ordinal: number) => unknown, summable = false): ScalarType {
  return {
    psl,
    values: fc
      .oneof({ weight: 3, arbitrary: existingOrdinals }, { weight: 1, arbitrary: unusedOrdinals })
      .map(distinct),
    equatable: true,
    distinct,
    summable,
  };
}

const day = 86_400_000;
const numbered = (ordinal: number) => ordinal;
const bigNumbered = (ordinal: number) => BigInt(ordinal);
const named = (ordinal: number) => `key${ordinal}`;
const dated = (ordinal: number) => new Date(Date.UTC(2000, 0, 1) + ordinal * day);
const datedText = (ordinal: number) => dated(ordinal).toISOString().slice(0, 10);
const uuidNumbered = (ordinal: number) =>
  `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;

function scalar(psl: string, values: fc.Arbitrary<unknown>, equatable = true): ScalarType {
  return { psl, values, equatable };
}

function parameterised<P>(
  parameters: fc.Arbitrary<P>,
  type: (parameters: P) => ScalarType,
): fc.Arbitrary<ScalarType> {
  return parameters.map(type);
}

const optional = <T>(arbitrary: fc.Arbitrary<T>) => fc.option(arbitrary, { nil: undefined });

function written(name: string, ...parameters: readonly (number | undefined)[]): string {
  const given = parameters.filter((parameter) => parameter !== undefined);
  return given.length === 0 ? name : `${name}(${given.join(', ')})`;
}

const text = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.string({ unit: 'grapheme', maxLength: 6 }),
  fc.constantFrom('', ' ', 'a ', "it's", 'a"b', 'NULL', '%_'),
);

function textUpTo(length: number | undefined): fc.Arbitrary<string> {
  return length === undefined ? text : fc.string({ maxLength: length });
}

const digits = (most: number) =>
  fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: most }).map((values) => values.join(''));

function decimalText(whole: number, fraction: number): fc.Arbitrary<string> {
  return fc
    .tuple(fc.boolean(), digits(whole), digits(fraction))
    .map(([negative, before, after]) => {
      const integer = before.replace(/^0+(?=\d)/, '') || '0';
      return `${negative ? '-' : ''}${integer}${after === '' ? '' : `.${after}`}`;
    });
}

const epochMilliseconds = fc.integer({
  min: Date.UTC(1900, 0, 1),
  max: Date.UTC(2100, 0, 1),
});
const jsDate = epochMilliseconds.map((milliseconds) => new Date(milliseconds));
const isoDateTime = jsDate.map((date) => date.toISOString().slice(0, 23));
const isoDate = isoDateTime.map((dateTime) => dateTime.slice(0, 10));

function fractionOfSecond(most: number): fc.Arbitrary<string> {
  return digits(most).map((fraction) => (fraction === '' ? '' : `.${fraction}`));
}

function isoTime(mostFractionDigits: number): fc.Arbitrary<string> {
  return fc
    .tuple(isoDateTime, fractionOfSecond(mostFractionDigits))
    .map(([dateTime, fraction]) => `${dateTime.slice(11, 19)}${fraction}`);
}

function isoLocalDateTime(mostFractionDigits: number): fc.Arbitrary<string> {
  return fc
    .tuple(isoDateTime, fractionOfSecond(mostFractionDigits))
    .map(([dateTime, fraction]) => `${dateTime.slice(0, 19)}${fraction}`);
}

const offset = fc.constantFrom('Z', '+00:00', '+02:00', '-05:30');

function isoInstant(mostFractionDigits: number): fc.Arbitrary<string> {
  return fc.tuple(isoLocalDateTime(mostFractionDigits), offset).map((parts) => parts.join(''));
}

function instant(mostFractionDigits: number): fc.Arbitrary<unknown> {
  return isoInstant(mostFractionDigits).map((iso) => Temporal.Instant.from(iso));
}

function plainDateTime(mostFractionDigits: number): fc.Arbitrary<unknown> {
  return isoLocalDateTime(mostFractionDigits).map((iso) => Temporal.PlainDateTime.from(iso));
}

function plainTime(mostFractionDigits: number): fc.Arbitrary<unknown> {
  return isoTime(mostFractionDigits)
    .filter((iso) => !iso.startsWith('23:59:59'))
    .map((iso) => Temporal.PlainTime.from(iso));
}

const plainDate = isoDate.map((iso) => Temporal.PlainDate.from(iso));
const durationText = fc.constantFrom(
  'PT0S',
  'PT1H30M',
  'P1Y2M',
  'P14M',
  'P1DT25H',
  'P3D',
  'PT0.5S',
);
const json = fc.jsonValue({ maxDepth: 2 }).filter((value) => value !== null);
const bytes = fc.uint8Array({ maxLength: 8 });
const safeInteger = fc.maxSafeInteger();
const int64 = fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n });
const precision = optional(fc.integer({ min: 0, max: 6 }));
const bits = (least: number, most: number) =>
  fc
    .array(fc.constantFrom('0', '1'), { minLength: least, maxLength: most })
    .map((values) => values.join(''));

const postgresTypes: readonly fc.Arbitrary<ScalarType>[] = [
  fc.constant(scalar('Text', text)),
  parameterised(optional(fc.integer({ min: 1, max: 12 })), (length) =>
    scalar(written('Varchar', length), textUpTo(length)),
  ),
  parameterised(optional(fc.integer({ min: 1, max: 6 })), (length) =>
    scalar(written('Char', length), textUpTo(length ?? 1)),
  ),
  fc.constant(scalar('Bool', fc.boolean())),
  fc.constant(scalar('Int2', fc.integer({ min: -32768, max: 32767 }))),
  fc.constant(scalar('Int4', fc.integer())),
  fc.constant(scalar('Int8BigInt', int64)),
  fc.constant(scalar('Int8Number', safeInteger)),
  fc.constant(scalar('NumericBigInt', fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }))),
  fc.constant(
    scalar(
      'Float4',
      fc.oneof(
        fc.float(),
        fc.integer({ min: -1_000_000, max: 1_000_000 }).map((thousandths) => thousandths / 1000),
      ),
    ),
  ),
  fc.constant(scalar('Float8', fc.double())),
  parameterised(
    optional(
      fc
        .integer({ min: 1, max: 20 })
        .chain((digitCount) =>
          fc.tuple(fc.constant(digitCount), optional(fc.integer({ min: 0, max: digitCount }))),
        ),
    ),
    (numeric) =>
      numeric === undefined
        ? scalar('NumericString', decimalText(12, 6))
        : scalar(
            written('NumericString', numeric[0], numeric[1]),
            decimalText(numeric[0] - (numeric[1] ?? 0), numeric[1] ?? 0),
          ),
  ),
  parameterised(precision, (p) => scalar(written('TimestamptzTemporal', p), instant(6))),
  parameterised(precision, (p) => scalar(written('TimestamptzJsDate', p), jsDate)),
  parameterised(precision, (p) => scalar(written('TimestamptzString', p), isoInstant(6))),
  parameterised(precision, (p) => scalar(written('TimestampTemporal', p), plainDateTime(6))),
  parameterised(precision, (p) => scalar(written('TimestampString', p), isoLocalDateTime(6))),
  parameterised(precision, (p) => scalar(written('TimestampJsDate', p), jsDate)),
  parameterised(precision, (p) => scalar(written('TimestampInstant', p), instant(6))),
  fc.constant(scalar('DateTemporal', plainDate)),
  fc.constant(scalar('DateString', isoDate)),
  parameterised(precision, (p) => scalar(written('TimeTemporal', p), plainTime(6))),
  parameterised(precision, (p) => scalar(written('TimeString', p), isoTime(6))),
  parameterised(precision, (p) =>
    scalar(
      written('Timetz', p),
      fc.tuple(isoTime(6), offset).map((parts) => parts.join('')),
    ),
  ),
  fc.constant(
    scalar(
      'Uuid',
      fc.oneof(
        fc.uuid(),
        fc.uuid().map((uuid) => uuid.toUpperCase()),
      ),
    ),
  ),
  fc.constant(
    scalar(
      'Inet',
      fc.oneof(
        fc.ipV4(),
        fc.ipV6(),
        fc.tuple(fc.ipV4(), fc.integer({ min: 0, max: 32 })).map((parts) => parts.join('/')),
      ),
    ),
  ),
  parameterised(precision, (p) =>
    scalar(
      written('IntervalParts', p),
      fc.record({
        months: fc.integer({ min: -100, max: 100 }),
        days: fc.integer({ min: -100, max: 100 }),
        micros: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      }),
    ),
  ),
  parameterised(precision, (p) => scalar(written('IntervalString', p), durationText)),
  parameterised(optional(fc.integer({ min: 1, max: 8 })), (length) =>
    scalar(written('Bit', length), bits(length ?? 1, length ?? 1)),
  ),
  parameterised(optional(fc.integer({ min: 1, max: 8 })), (length) =>
    scalar(written('Varbit', length), bits(0, length ?? 8)),
  ),
  fc.constant(
    scalar('Xml', fc.constantFrom('<a/>', '<a>text</a>', '<a b="1"><c/></a>', 'text'), false),
  ),
  fc.constant(scalar('Oid', fc.integer({ min: 0, max: 4294967295 }))),
  fc.constant(scalar('Money', decimalText(8, 2))),
  fc.constant(scalar('PlainJson', json, false)),
  fc.constant(scalar('Jsonb', json)),
  fc.constant(scalar('Bytea', bytes)),
];

const sqliteTypes: readonly fc.Arbitrary<ScalarType>[] = [
  fc.constant(scalar('String', text)),
  fc.constant(scalar('Int', safeInteger)),
  fc.constant(scalar('BigInt', safeInteger.map(BigInt))),
  fc.constant(scalar('BigIntNumber', safeInteger)),
  fc.constant(scalar('Float', fc.double())),
  fc.constant(scalar('Decimal', decimalText(12, 6))),
  fc.constant(scalar('DatetimeJsDate', jsDate)),
  fc.constant(scalar('DatetimeTemporal', instant(3))),
  fc.constant(scalar('DatetimeString', isoInstant(3))),
  fc.constant(scalar('DateString', isoDate)),
  fc.constant(scalar('DateTemporal', plainDate)),
  fc.constant(scalar('TimeString', isoTime(3))),
  fc.constant(scalar('TimeTemporal', plainTime(3))),
  fc.constant(scalar('DurationString', durationText)),
  fc.constant(scalar('Json', json)),
  fc.constant(scalar('Bytes', bytes)),
  parameterised(fc.integer({ min: 1, max: 12 }), (length) =>
    scalar(written('sql.Varchar', length), textUpTo(length)),
  ),
  parameterised(fc.integer({ min: 1, max: 6 }), (length) =>
    scalar(
      written('sql.Char', length),
      textUpTo(length).map((value) => value.trimEnd()),
    ),
  ),
];

const short = (ordinal: number) => `k${ordinal}`;
const halved = (ordinal: number) => ordinal + 0.5;
const decimal = (ordinal: number) => `${ordinal}.5`;
const even = (ordinal: number) => ordinal % 2 === 0;
const oneByte = (ordinal: number) => Uint8Array.of(ordinal % 256);
const eightBits = (ordinal: number) => (ordinal % 256).toString(2).padStart(8, '0');
const someBits = (ordinal: number) => (ordinal % 256).toString(2);
const address = (ordinal: number) =>
  even(ordinal) ? `10.0.0.${ordinal % 256}/32` : `10.0.0.${ordinal % 256}`;
const days = (ordinal: number) => `P${ordinal}D`;
const dayParts = (ordinal: number) => ({ months: 0, days: ordinal, micros: 0n });
const keyed = (ordinal: number) => ({ key: ordinal });
const mixedCaseUuid = (ordinal: number) =>
  even(ordinal) ? uuidNumbered(ordinal).toUpperCase() : uuidNumbered(ordinal);
const clock = (ordinal: number) =>
  `${String(Math.floor(ordinal / 60) % 24).padStart(2, '0')}:${String(ordinal % 60).padStart(2, '0')}:00`;
const clockWithZone = (ordinal: number) => `${clock(ordinal)}${even(ordinal) ? 'Z' : '+00:00'}`;
const instantText = (ordinal: number) =>
  `${datedText(ordinal)}T00:00:00${even(ordinal) ? 'Z' : '+00:00'}`;
const localText = (ordinal: number) => `${datedText(ordinal)}T00:00:00`;
const instantOf = (ordinal: number) => Temporal.Instant.from(`${datedText(ordinal)}T00:00:00Z`);
const localOf = (ordinal: number) => Temporal.PlainDateTime.from(localText(ordinal));
const dateOf = (ordinal: number) => Temporal.PlainDate.from(datedText(ordinal));
const timeOf = (ordinal: number) => Temporal.PlainTime.from(clock(ordinal));

function keyWith<P>(
  parameters: fc.Arbitrary<P>,
  psl: (parameters: P) => string,
  distinct: (ordinal: number) => unknown,
): fc.Arbitrary<ScalarType> {
  return parameters.map((chosen) => key(psl(chosen), distinct));
}

const keyLength = fc.integer({ min: 4, max: 9 });
const keyScale = fc.integer({ min: 1, max: 4 });

const postgresKeyTypes: readonly fc.Arbitrary<ScalarType>[] = [
  fc.constant(key('Int4', numbered, true)),
  fc.constant(key('Int2', numbered, true)),
  fc.constant(key('Int8BigInt', bigNumbered)),
  fc.constant(key('Int8Number', numbered)),
  fc.constant(key('NumericBigInt', bigNumbered)),
  fc.constant(key('Oid', numbered)),
  fc.constant(key('Float4', halved)),
  fc.constant(key('Float8', halved)),
  fc.constant(key('Money', decimal)),
  keyWith(keyScale, (scale) => written('NumericString', scale + 6, scale), decimal),
  fc.constant(key('Text', named)),
  keyWith(keyLength, (length) => written('Varchar', length), short),
  keyWith(keyLength, (length) => written('Char', length), short),
  fc.constant(key('Uuid', mixedCaseUuid)),
  fc.constant(key('Inet', address)),
  fc.constant(key('Bytea', oneByte)),
  fc.constant(key('Jsonb', keyed)),
  fc.constant(key('Bit(8)', eightBits)),
  fc.constant(key('Varbit(8)', someBits)),
  fc.constant(key('DateString', datedText)),
  fc.constant(key('DateTemporal', dateOf)),
  keyWith(precision, (p) => written('TimeString', p), clock),
  keyWith(precision, (p) => written('TimeTemporal', p), timeOf),
  keyWith(precision, (p) => written('Timetz', p), clockWithZone),
  keyWith(precision, (p) => written('TimestamptzJsDate', p), dated),
  keyWith(precision, (p) => written('TimestamptzTemporal', p), instantOf),
  keyWith(precision, (p) => written('TimestamptzString', p), instantText),
  keyWith(precision, (p) => written('TimestampJsDate', p), dated),
  keyWith(precision, (p) => written('TimestampInstant', p), instantOf),
  keyWith(precision, (p) => written('TimestampTemporal', p), localOf),
  keyWith(precision, (p) => written('TimestampString', p), localText),
  keyWith(precision, (p) => written('IntervalString', p), days),
  keyWith(precision, (p) => written('IntervalParts', p), dayParts),
];

const sqliteKeyTypes: readonly fc.Arbitrary<ScalarType>[] = [
  fc.constant(key('Int', numbered, true)),
  fc.constant(key('BigInt', bigNumbered)),
  fc.constant(key('BigIntNumber', numbered)),
  fc.constant(key('Float', halved)),
  fc.constant(key('Decimal', decimal)),
  fc.constant(key('String', named)),
  keyWith(keyLength, (length) => written('sql.Varchar', length), short),
  keyWith(keyLength, (length) => written('sql.Char', length), short),
  fc.constant(key('Bytes', oneByte)),
  fc.constant(key('Json', keyed)),
  fc.constant(key('DateString', datedText)),
  fc.constant(key('DateTemporal', dateOf)),
  fc.constant(key('TimeString', clock)),
  fc.constant(key('TimeTemporal', timeOf)),
  fc.constant(key('DatetimeJsDate', dated)),
  fc.constant(key('DatetimeTemporal', instantOf)),
  fc.constant(key('DatetimeString', instantText)),
  fc.constant(key('DurationString', days)),
];

const notKeysOfGeneratedModels = [
  'Bytea',
  'Jsonb',
  'Bytes',
  'Json',
  'DurationString',
  'IntervalParts',
];

function ordered(type: ScalarType): boolean {
  return !notKeysOfGeneratedModels.includes(type.psl.replace(/\(.*$/, ''));
}

export const keyTypes = {
  postgres: fc.oneof(...postgresKeyTypes).filter(ordered),
  sqlite: fc.oneof(...sqliteKeyTypes).filter(ordered),
} as const;

export const oneOfEachKeyType = {
  postgres: fc.tuple(...postgresKeyTypes),
  sqlite: fc.tuple(...sqliteKeyTypes),
} as const;

export const generatedKeyType = key('Int', numbered, true);

export const discriminatorType: ScalarType = {
  psl: 'String',
  values: fc.constant('unset'),
  equatable: true,
};

export const oneOfEachScalarType = {
  postgres: fc.tuple(...postgresTypes),
  sqlite: fc.tuple(...sqliteTypes),
} as const;
