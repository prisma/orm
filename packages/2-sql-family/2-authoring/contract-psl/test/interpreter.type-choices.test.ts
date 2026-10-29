import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresNativeScalarTypeDescriptors, postgresScalarAuthoringTypes } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

const precision = {
  kind: 'value',
  dataType: 'pg/int4',
  name: 'precision',
  optional: true,
} as const;

const types = {
  ...postgresScalarAuthoringTypes,
  TimestampString: {
    kind: 'typeConstructor',
    args: [precision],
    output: {
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  DateTemporal: { kind: 'typeConstructor', output: { codecId: 'pg/date-temporal@1' } },
  DateString: { kind: 'typeConstructor', output: { codecId: 'pg/date-string@1' } },
  Moment: {
    kind: 'typeChoice',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['temporal', 'string'],
        default: 'temporal',
        optional: true,
      },
      { kind: 'option', name: 'storage', values: ['tz', 'local'], default: 'tz', optional: true },
      precision,
    ],
    choices: [
      {
        when: { as: 'temporal', storage: 'tz' },
        type: 'TimestamptzTemporal',
        defaults: { precision: 3 },
      },
      { when: { as: 'temporal', storage: 'local' }, type: 'TimestampTemporal' },
      { when: { as: 'string', storage: 'local' }, type: 'TimestampString' },
    ],
  },
  Day: {
    kind: 'typeChoice',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      precision,
    ],
    choices: [
      { when: { as: 'string' }, type: 'DateString' },
      { when: { as: 'temporal' }, type: 'DateTemporal' },
    ],
  },
  Label: {
    kind: 'typeChoice',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['text', 'number'],
        default: 'text',
        optional: true,
      },
    ],
    choices: [
      { when: { as: 'text' }, type: 'String' },
      { when: { as: 'number' }, type: 'Int' },
    ],
  },
} satisfies AuthoringTypeNamespace;

const authoringContributions = {
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: types,
} satisfies AuthoringContributions;

function interpret(schema: string) {
  return interpretPostgresSchema(schema, {
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions,
  });
}

function lowered(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics, null, 2));
  return {
    tables: unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value)),
    defaults: result.value.execution?.mutations.defaults ?? [],
  };
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message, span }) => ({
    code,
    message,
    columns: [span?.start.column, span?.end.column],
  }));
}

const model = (...fields: readonly string[]) =>
  ['model T {', '  id Int @id', ...fields.map((field) => `  ${field}`), '}'].join('\n');

describe('a type choice in a field type', () => {
  it('emits what writing the type it chooses emits, bare, named and positional', () => {
    expect(
      lowered(
        model(
          'bare Moment',
          'named Moment(as: string, storage: local)',
          'positional Moment(temporal, local, 6)',
          'day Day(as: temporal)',
          'list Moment[]',
          'maybe Moment?',
        ),
      ),
    ).toEqual(
      lowered(
        model(
          'bare TimestamptzTemporal(3)',
          'named TimestampString',
          'positional TimestampTemporal(6)',
          'day DateTemporal',
          'list TimestamptzTemporal(3)[]',
          'maybe TimestamptzTemporal(3)?',
        ),
      ),
    );
  });

  it('passes a written precision over the row default', () => {
    expect(lowered(model('at Moment(precision: 6)'))).toEqual(
      lowered(model('at TimestamptzTemporal(6)')),
    );
  });

  it('refuses an unlisted combination at the argument that makes it invalid', () => {
    const line = 'at Moment(as: string, storage: tz)';
    const start = '  '.length + line.indexOf('storage');
    expect(diagnostics(model(line))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "T.at" type "Moment": Argument "storage" of Moment cannot be tz with as: string; write one of: local.',
        columns: [start + 1, start + 1 + 'storage: tz'.length],
      },
    ]);
  });

  it('refuses a value the option does not list, naming the values it does', () => {
    expect(diagnostics(model('at Day(as: jsDate)'))).toMatchObject([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "T.at" type "Day": Argument "as" of Day is jsDate; write one of: string, temporal.',
      },
    ]);
  });

  it('refuses a passed-on argument the chosen type does not take', () => {
    expect(diagnostics(model('at Day(precision: 3)'))).toMatchObject([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "T.at" type "Day": Argument "precision" of Day does not apply to DateString, the type that as: string chooses.',
      },
    ]);
  });

  it('refuses an argument the choice does not declare, naming the arguments it does', () => {
    const line = 'at Moment(value: 3)';
    const start = '  '.length + line.indexOf('value');
    expect(diagnostics(model(line))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "T.at" type "Moment" has no argument "value"; its arguments are as, storage and precision.',
        columns: [start + 1, start + 1 + 'value: 3'.length],
      },
    ]);
  });

  it('refuses a precision the chosen type’s codec refuses, naming the argument of the choice', () => {
    const line = 'at Moment(as: temporal, storage: local, precision: 7)';
    const start = '  '.length + line.indexOf('precision');
    expect(diagnostics(model(line))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "T.at" type "Moment": Argument "precision" of Moment is invalid: precision must be at most 6 (was 7)',
        columns: [start + 1, start + 1 + 'precision: 7'.length],
      },
    ]);
  });
});

describe('a type choice behind a types {} alias', () => {
  it('emits what the type it chooses emits', () => {
    expect(
      lowered(`types {
  Stamp = Moment(as: string, storage: local)
  Plain = Moment
}
${model('stamp Stamp', 'plain Plain')}`),
    ).toEqual(lowered(model('stamp TimestampString', 'plain TimestamptzTemporal(3)')));
  });
});

describe('attributes on a field typed by a type choice', () => {
  it('admit a @default by the codec the call chooses', () => {
    expect(lowered(model('label Label @default("a")'))).toEqual(
      lowered(model('label String @default("a")')),
    );
    expect(diagnostics(model('label Label(as: number) @default("a")'))).toMatchObject([
      { code: 'PSL_VALUE_TYPE_INCOMPATIBLE' },
    ]);
  });

  it('admit a @default by the codec the alias’s call chooses', () => {
    expect(
      diagnostics(`types {
  Count = Label(as: number)
}
${model('count Count @default("a")')}`),
    ).toMatchObject([{ code: 'PSL_VALUE_TYPE_INCOMPATIBLE' }]);
  });

  it('resolve @onCreate and @onUpdate generators for the codec the call chooses', () => {
    expect(
      lowered(
        model(
          'a Moment @onCreate(now()) @onUpdate(now())',
          'b Moment(as: string, storage: local) @onCreate(now())',
          'c Day @onCreate(now())',
        ),
      ),
    ).toEqual(
      lowered(
        model(
          'a TimestamptzTemporal(3) @onCreate(now()) @onUpdate(now())',
          'b TimestampString @onCreate(now())',
          'c DateString @onCreate(now())',
        ),
      ),
    );
  });

  it('resolve generators through an alias written as a type choice', () => {
    expect(
      lowered(`types {
  Stamp = Moment(as: string, storage: local) @onCreate(now())
}
${model('stamp Stamp')}`),
    ).toEqual(lowered(model('stamp TimestampString @onCreate(now())')));
  });
});
