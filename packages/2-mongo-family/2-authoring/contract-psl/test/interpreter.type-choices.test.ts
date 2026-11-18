import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const label = { kind: 'value', dataType: 'mongo/string', name: 'label', optional: true } as const;

const type = {
  ObjectId: { kind: 'typeConstructor', output: { codecId: 'mongo/objectId@1' } },
  Stamp: { kind: 'typeConstructor', output: { codecId: 'mongo/date@1' } },
  Text: {
    kind: 'typeConstructor',
    args: [label],
    output: { codecId: 'mongo/string@1', typeParams: { label: { kind: 'arg', index: 0 } } },
  },
  Moment: {
    kind: 'typeChoice',
    args: [
      { kind: 'option', name: 'as', values: ['date', 'text'], default: 'date', optional: true },
      label,
    ],
    choices: [
      { when: { as: 'date' }, type: 'Stamp' },
      { when: { as: 'text' }, type: 'Text' },
    ],
  },
} as const satisfies AuthoringTypeNamespace;

const authoringContributions: AuthoringContributions = { type };

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    defaultFunctionRegistry: new Map(),
    authoringContributions,
  });
}

const model = (...fields: readonly string[]) =>
  ['model Doc {', '  id ObjectId @id @map("_id")', ...fields.map((f) => `  ${f}`), '}', ''].join(
    '\n',
  );

function fieldTypes(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const fields = result.value.domain.namespaces['__unbound__']?.models['Doc']?.fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.type]));
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('a MongoDB field typed by a type choice', () => {
  it('gets the type of the constructor its call chooses, bare, named and positional', () => {
    expect(
      fieldTypes(model('bare Moment', 'named Moment(as: text)', 'positional Moment(text, "x")')),
    ).toEqual({
      id: { kind: 'scalar', codecId: 'mongo/objectId@1' },
      bare: { kind: 'scalar', codecId: 'mongo/date@1' },
      named: { kind: 'scalar', codecId: 'mongo/string@1' },
      positional: { kind: 'scalar', codecId: 'mongo/string@1', typeParams: { label: 'x' } },
    });
  });

  it('gets the type its alias’s call chooses', () => {
    expect(fieldTypes(`types {\n  Note = Moment(as: text)\n}\n${model('note Note')}`)).toEqual({
      id: { kind: 'scalar', codecId: 'mongo/objectId@1' },
      note: { kind: 'scalar', codecId: 'mongo/string@1' },
    });
  });

  it.each([
    [
      'an unknown named argument',
      'Moment(bogus: date)',
      'Field "Doc.at" type "Moment" has no argument "bogus"; its arguments are as and label.',
    ],
    [
      'a value the option does not list',
      'Moment(as: json)',
      'Field "Doc.at" type "Moment": Argument "as" of Moment is json; write one of: date, text.',
    ],
    [
      'an argument the chosen type does not take',
      'Moment(label: "x")',
      'Field "Doc.at" type "Moment": Argument "label" of Moment does not apply to Stamp, the type that as: date chooses.',
    ],
  ])('refuses %s at the argument', (_case, written, message) => {
    expect(diagnostics(model(`at ${written}`))).toEqual([
      { code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT', message },
    ]);
  });
});
