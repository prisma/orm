import { describe, expect, it } from 'vitest';
import { interpretSchemaText, interpretSchemaTextResult } from './support';

const PREFIX = '  value String @default(';

function schemaWith(call: string): string {
  return `datasource db {\n  provider = "postgresql"\n}\n\nmodel Row {\n  id Int @id\n${PREFIX}${call})\n}\n`;
}

/** Each diagnostic for `call`, with the columns it spans on the field's line. */
function refusals(call: string) {
  const result = interpretSchemaTextResult(schemaWith(call));
  if (result.ok) throw new Error(`expected ${call} to be refused`);
  return result.failure.diagnostics.map(({ code, message, span }) => ({
    code,
    message,
    line: span?.start.line,
    columns: [span?.start.column, span?.end.column],
  }));
}

function columnsOf(call: string, text: string) {
  const start = PREFIX.length + call.indexOf(text) + 1;
  return [start, start + text.length];
}

describe('Prisma 7 default function arguments', () => {
  it.each([
    ['uuid(5)', '5', 'uuid: version must be 4 or 7, got 5'],
    ['nanoid(1)', '1', 'nanoid: size must be between 2 and 255, got 1'],
    ['nanoid(1000)', '1000', 'nanoid: size must be between 2 and 255, got 1000'],
    ['nanoid(8.5)', '8.5', 'Expected a number that pg/int4 can hold; got pg/numeric'],
    ['cuid(1)', '1', 'cuid: version must be 2, got 1'],
  ])('refuse %s at the argument with the message of the function', (call, argument, message) => {
    expect(refusals(call)).toEqual([
      {
        code: 'PSL.PRISMA7_UNKNOWN_DEFAULT',
        message: `Field "Row.value": ${message}`,
        line: 7,
        columns: columnsOf(call, argument),
      },
    ]);
  });

  it('refuses a named argument', () => {
    expect(refusals('uuid(version: 7)')).toEqual([
      {
        code: 'PSL.PRISMA7_UNKNOWN_DEFAULT',
        message: 'Field "Row.value": Generator function "uuid" received unknown argument "version"',
        line: 7,
        columns: columnsOf('uuid(version: 7)', 'version: 7'),
      },
    ]);
  });

  it('refuses a column too short for what the generator writes', () => {
    const result = interpretSchemaTextResult(
      'datasource db {\n  provider = "postgresql"\n}\n\nmodel Row {\n  id Int @id\n  value String @db.Char(5) @default(uuid())\n}\n',
    );
    expect(
      result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL.PRISMA7_GENERATOR_REFUSED',
        message:
          'Field "Row.value": @default(uuid()) cannot fill its column: uuid() writes 36 characters, which does not fit a column of 5 characters.',
      },
    ]);
  });

  it.each([
    ['uuid()', { kind: 'generator', id: 'uuidv4' }],
    ['uuid(7)', { kind: 'generator', id: 'uuidv7' }],
    ['cuid()', { kind: 'generator', id: 'cuid2' }],
    ['cuid(2)', { kind: 'generator', id: 'cuid2' }],
    ['nanoid()', { kind: 'generator', id: 'nanoid' }],
    ['nanoid(12)', { kind: 'generator', id: 'nanoid', params: { size: 12 } }],
  ])('lower %s as before', (call, onCreate) => {
    expect(interpretSchemaText(schemaWith(call)).execution?.mutations.defaults).toEqual([
      { ref: { namespace: 'public', entry: 'Row', field: 'value' }, onCreate },
    ]);
  });
});
