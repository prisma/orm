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
  postgresScalarAndNativeTypeConstructors,
} from '../src/core/type-constructors';

const codecLookup = createPostgresBuiltinCodecLookup();

const constructors: ReadonlyMap<string, AuthoringTypeConstructorDescriptor> = new Map(
  Object.entries(postgresScalarAndNativeTypeConstructors).flatMap(([name, member]) =>
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
