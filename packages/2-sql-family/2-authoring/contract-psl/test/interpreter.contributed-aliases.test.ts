import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresNativeScalarTypeDescriptors, postgresScalarAuthoringTypes } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

const timestamptz = { codecId: 'pg/timestamptz-temporal@1' } as const;
const now = { name: 'now', args: {} } as const;

const authoringContributions = {
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: {
    ...postgresScalarAuthoringTypes,
    temporal: {
      CreatedAt: {
        kind: 'typeAlias',
        documentation: 'A timestamptz the client sets to now when a row is created.',
        output: { type: timestamptz, onCreate: now },
      },
      UpdatedAt: {
        kind: 'typeAlias',
        output: { type: timestamptz, onCreate: now, onUpdate: now },
      },
    },
  },
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
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('a contributed type alias', () => {
  it('gives each field typed by it the column and generators of writing them on the field', () => {
    const throughAlias = lowered(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}`);
    const onTheField = lowered(`model Event {
  id        Int         @id
  createdAt TimestamptzTemporal @onCreate(now())
  updatedAt TimestamptzTemporal @onCreate(now()) @onUpdate(now())
}`);
    expect(throughAlias).toEqual(onTheField);
    expect(throughAlias.defaults).toEqual([
      {
        ref: { namespace: 'public', entry: 'Event', field: 'createdAt' },
        onCreate: { kind: 'generator', id: 'instantNow' },
      },
      {
        ref: { namespace: 'public', entry: 'Event', field: 'updatedAt' },
        onCreate: { kind: 'generator', id: 'instantNow' },
        onUpdate: { kind: 'generator', id: 'instantNow' },
      },
    ]);
  });

  it('lets a field add an attribute the alias does not set, and be optional', () => {
    expect(
      lowered(`model Event {
  id        Int                 @id
  updatedAt temporal.CreatedAt? @onUpdate(now())
}`),
    ).toEqual(
      lowered(`model Event {
  id        Int          @id
  updatedAt TimestamptzTemporal? @onCreate(now()) @onUpdate(now())
}`),
    );
  });

  it('is refused with arguments', () => {
    expect(
      diagnostics(`model Event {
  id        Int                   @id
  createdAt temporal.CreatedAt(3)
}`),
    ).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: 'temporal.CreatedAt is a type alias and takes no arguments.',
      },
    ]);
  });

  it('refuses a field that writes an attribute the alias sets', () => {
    expect(
      diagnostics(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt @onCreate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Event.createdAt" writes @onCreate, which its type alias "temporal.CreatedAt" already sets. Remove one of them.',
      },
    ]);
  });

  it('refuses a list field typed by it', () => {
    expect(
      diagnostics(`model Event {
  id     Int                  @id
  stamps temporal.CreatedAt[]
}`),
    ).toEqual([
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Event.stamps" is a list, and its type alias "temporal.CreatedAt" generates a value. Lists have no per-element generated values; remove "[]" or type the field without the alias.',
      },
    ]);
  });

  it('is not a base of a types {} alias', () => {
    expect(
      diagnostics(`types {
  Stamp = temporal.UpdatedAt
}

model Event {
  id Int @id
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "Stamp" is written as the type alias "temporal.UpdatedAt", and a type alias cannot be written as another one. Type the fields temporal.UpdatedAt instead, or write: Stamp = DateTime @onCreate(now()) @onUpdate(now())',
      },
    ]);
  });
});
