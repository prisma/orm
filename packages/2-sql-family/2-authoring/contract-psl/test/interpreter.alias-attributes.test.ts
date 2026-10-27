import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresNativeScalarTypeDescriptors, postgresScalarAuthoringTypes } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

const authoringContributions = {
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: postgresScalarAuthoringTypes,
} satisfies AuthoringContributions;

function interpret(schema: string, contributions: AuthoringContributions = authoringContributions) {
  return interpretPostgresSchema(schema, {
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions: contributions,
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
  return diagnosticsWith(schema, authoringContributions);
}

function diagnosticsWith(schema: string, contributions: AuthoringContributions) {
  const result = interpret(schema, contributions);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message, span }) => ({
    code,
    message,
    line: span?.start.line,
  }));
}

describe('attributes on a types {} alias', () => {
  it('give each field typed by the alias what the same attributes give when written on the field', () => {
    const throughAlias = lowered(`types {
  Stamp = TimestampTemporal(3) @default(now()) @onCreate(now()) @onUpdate(now())
}

model Event {
  id        Int   @id
  createdAt Stamp
  updatedAt Stamp
}`);
    const onTheField = lowered(`model Event {
  id        Int          @id
  createdAt TimestampTemporal(3) @default(now()) @onCreate(now()) @onUpdate(now())
  updatedAt TimestampTemporal(3) @default(now()) @onCreate(now()) @onUpdate(now())
}`);
    expect(throughAlias).toEqual(onTheField);
    expect(onTheField.defaults).toHaveLength(2);
  });

  it('let a field add an attribute its alias does not set', () => {
    const throughAlias = lowered(`types {
  Key   = Uuid @onCreate(uuid())
  Stamp = TimestampTemporal(3) @onUpdate(now())
}

model Event {
  id        Key   @id
  updatedAt Stamp @default(now())
}`);
    const onTheField = lowered(`model Event {
  id        Uuid         @id @onCreate(uuid())
  updatedAt TimestampTemporal(3) @default(now()) @onUpdate(now())
}`);
    expect(throughAlias).toEqual(onTheField);
  });

  it('refuse @id and @unique on an alias, and keep the alias for its fields', () => {
    expect(
      diagnostics(`types {
  Key  = Uuid @id
  Slug = VarChar(64) @unique
}

model Event {
  id   Key
  slug Slug
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Key" cannot carry @id. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
        line: 2,
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Slug" cannot carry @unique. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
        line: 3,
      },
    ]);
  });

  it('refuse any other attribute on an alias, and keep the alias for its fields', () => {
    expect(
      diagnostics(`types {
  Slug = VarChar(64) @map("slug")
}

model Event {
  id   Int  @id
  slug Slug
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: 'Type alias "Slug" uses unsupported attribute "map"',
        line: 2,
      },
    ]);
  });

  it('refuse a field that repeats an attribute its alias sets, naming the alias', () => {
    expect(
      diagnostics(`types {
  Stamp = TimestampTemporal(3) @default(now()) @onCreate(now()) @onUpdate(now())
}

model Event {
  id        Int   @id
  createdAt Stamp @default(now())
  seenAt    Stamp @onCreate(now())
  updatedAt Stamp @onUpdate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Event.createdAt" writes @default, which its type alias "Stamp" already sets. Remove one of them.',
        line: 7,
      },
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Event.seenAt" writes @onCreate, which its type alias "Stamp" already sets. Remove one of them.',
        line: 8,
      },
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Event.updatedAt" writes @onUpdate, which its type alias "Stamp" already sets. Remove one of them.',
        line: 9,
      },
    ]);
  });

  it('refuse an alias that repeats a generator attribute, naming the alias', () => {
    expect(
      diagnostics(`types {
  Stamp = TimestampTemporal(3) @onCreate(now()) @onCreate(now())
}

model Event {
  id      Int   @id
  stamped Stamp
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@onCreate` declared more than once on type alias "Stamp".',
        line: 2,
      },
    ]);
  });

  it('refuse a composite type member typed by an alias that carries an attribute', () => {
    expect(
      diagnosticsWith(
        `types {
  Stamp = TimestampTemporal(3) @onCreate(now())
}

type Audit {
  at Stamp
}

model Event {
  id    Int   @id
  audit Audit
}`,
        { ...authoringContributions, valueObjectStorageType: 'Jsonb' },
      ),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Member "at" of composite type "Audit" is typed by the type alias "Stamp", which carries "@onCreate", an attribute a composite type member does not take',
        line: 6,
      },
    ]);
  });

  it('report a generator that does not apply to the alias once, on the alias', () => {
    expect(
      diagnostics(`types {
  Blob = Bytes @onCreate(uuid())
}

model Event {
  id     Int  @id
  first  Blob
  second Blob
}`),
    ).toEqual([
      {
        code: 'PSL_GENERATOR_NOT_APPLICABLE',
        message: expect.stringContaining('Type alias "Blob": uuid() does not apply'),
        line: 2,
      },
    ]);
  });

  it('report an invalid default once, on the alias', () => {
    expect(
      diagnostics(`types {
  Count = Int @default("many")
}

model Event {
  id     Int   @id
  first  Count
  second Count
}`),
    ).toEqual([
      {
        code: expect.any(String),
        message: expect.stringContaining('Type alias "Count"'),
        line: 2,
      },
    ]);
  });

  it('refuse a list field typed by an alias that generates a value', () => {
    expect(
      diagnostics(`types {
  Stamp = TimestampTemporal(3) @onCreate(now())
}

model Event {
  id     Int     @id
  stamps Stamp[]
}`),
    ).toEqual([
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Event.stamps" is a list, and its type alias "Stamp" generates a value. Lists have no per-element generated values; remove "[]" or type the field without the alias.',
        line: 7,
      },
    ]);
  });

  it('refuse a list field typed by an alias that sets a default', () => {
    expect(
      diagnostics(`types {
  Tag = String @default("a")
}

model Event {
  id   Int   @id
  tags Tag[]
}`),
    ).toEqual([
      {
        code: 'PSL_DEFAULT_LIST_EXPECTED',
        message:
          'Field "Event.tags" is a list, but its type alias "Tag" sets @default for a single value. Remove "[]" or the @default of the alias.',
        line: 7,
      },
    ]);
  });

  it('accept an optional field typed by an alias that generates a value', () => {
    const throughAlias = lowered(`types {
  Stamp = TimestampTemporal(3) @onCreate(now())
}

model Event {
  id      Int    @id
  stamped Stamp?
}`);
    const onTheField = lowered(`model Event {
  id      Int           @id
  stamped TimestampTemporal(3)? @onCreate(now())
}`);
    expect(throughAlias).toEqual(onTheField);
    expect(onTheField.defaults).toHaveLength(1);
  });
});
