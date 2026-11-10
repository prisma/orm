import {
  type AuthoringTypeChoiceDescriptor,
  type AuthoringTypeConstructorDescriptor,
  isAuthoringTypeChoiceOption,
  resolveAuthoringTypeChoice,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import {
  postgresConvenienceDateTimeTypes,
  postgresConvenienceScalarTypes,
  postgresScalarTypes,
} from '../src/core/type-constructors';

const codecLookup = createPostgresBuiltinCodecLookup();

const constructors: ReadonlyMap<string, AuthoringTypeConstructorDescriptor> = new Map(
  Object.entries(postgresScalarTypes).flatMap(([name, member]) =>
    member.kind === 'typeConstructor' ? [[name, member]] : [],
  ),
);

function dataTypeOf(constructorName: string): string | undefined {
  const codecId = constructors.get(constructorName)?.output.codecId;
  return codecId === undefined ? undefined : codecLookup.descriptorFor(codecId)?.dataType;
}

/** For each `storage` value, the explicit type a call writing only that value becomes. */
function convenienceDefaults(choice: AuthoringTypeChoiceDescriptor): readonly string[] {
  const storage = choice.args.find(
    (argument) => isAuthoringTypeChoiceOption(argument) && argument.name === 'storage',
  );
  const values =
    storage !== undefined && isAuthoringTypeChoiceOption(storage) ? storage.values : [];
  return values.map(
    (value) =>
      resolveAuthoringTypeChoice({
        helperPath: 'choice',
        descriptor: choice,
        args: choice.args.map((argument) => (argument === storage ? value : undefined)),
        constructorNamed: (name) => constructors.get(name),
      }).type,
  );
}

const defaults = Object.values(postgresConvenienceDateTimeTypes).flatMap(convenienceDefaults);
const scalarDefaults = Object.values(postgresConvenienceScalarTypes).flatMap(convenienceDefaults);

function markedFor(constructorName: string) {
  const dataType = dataTypeOf(constructorName);
  const marked = [...constructors].flatMap(([name, descriptor]) =>
    descriptor.inferred === true && dataTypeOf(name) === dataType ? [name] : [],
  );
  return { dataType, marked };
}

describe('the explicit type contract infer writes for an integer, decimal, float, text, boolean or binary column', () => {
  const expected = [
    ['pg/int2', 'Int2'],
    ['pg/int4', 'Int4'],
    ['pg/int8', 'Int8BigInt'],
    ['pg/numeric', 'NumericString'],
    ['pg/float4', 'Float4'],
    ['pg/float8', 'Float8'],
    ['pg/text', 'Text'],
    ['pg/varchar', 'Varchar'],
    ['pg/char', 'Char'],
    ['pg/bool', 'Bool'],
    ['pg/bytea', 'Bytea'],
  ] as const;

  it.each(expected)('for %s is %s, and no other type is marked', (dataType, constructorName) => {
    expect(markedFor(constructorName)).toEqual({ dataType, marked: [constructorName] });
  });

  it.each(expected)(
    'for %s is %s, a type a convenience call writing only storage gives',
    (_dataType, constructorName) => {
      expect(scalarDefaults).toContain(constructorName);
    },
  );

  it('is not the type BigInt(storage: numeric) gives, since Decimal is the default for numeric', () => {
    expect(markedFor('NumericBigInt').marked).toEqual(['NumericString']);
  });
});

describe('the explicit type contract infer writes for a date or time column', () => {
  it.each(defaults)(
    'is %s, the type the convenience default for its data type gives',
    (constructorName) => {
      const dataType = dataTypeOf(constructorName);
      const marked = [...constructors].flatMap(([name, descriptor]) =>
        descriptor.inferred === true && dataTypeOf(name) === dataType ? [name] : [],
      );
      expect({ dataType, marked }).toEqual({ dataType, marked: [constructorName] });
    },
  );

  it('covers every date and time data type', () => {
    expect(defaults.map(dataTypeOf).sort()).toEqual([
      'pg/date',
      'pg/interval',
      'pg/time',
      'pg/timestamp',
      'pg/timestamptz',
      'pg/timetz',
    ]);
  });
});
