/**
 * `@@fullTextIndex` stores the index as data: a `gin` index over the covered
 * columns, whose options hold the weight groups and the language. The search
 * document is rendered from those options when the index is created and when
 * a query searches it, so no SQL text is stored.
 */

import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { bindPslSchema } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { postgresIndexTypes } from '../src/core/index-types';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { postgresDataTypeSupport } from './fixtures/postgres-data-type-support';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
      type: postgresAuthoringTypes,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  indexTypes: postgresIndexTypes,
};

const scalarTypeDescriptors = new Map<string, { codecId: string }>([
  ['String', { codecId: 'pg/text@1' }],
  ['Int', { codecId: 'pg/int4@1' }],
  // The family's varchar codec, to prove the attribute accepts every `textual`
  // codec rather than `pg/text@1` alone.
  ['Varchar', { codecId: 'sql/varchar@1' }],
]);

// `pg.enum(Ref)` resolves its column through the enum codec's descriptor.
const codecLookup: CodecLookupWithDescriptors = createPostgresBuiltinCodecLookup();

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarTypeDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-full-text-index.test.psl');
  const { diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });
  expect(diagnostics).toEqual([]);

  const bound = bindPslSchema(source, {
    sourceId: 'psl-full-text-index.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup,
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: postgresDataTypeSupport,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTarget,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function indexesOf(source: string) {
  const result = interpret(source);
  expect(result.ok).toBe(true);
  if (!result.ok) return [];
  const namespace = result.value.storage.namespaces['public'] as PostgresSchema;
  return namespace.table['Message']?.indexes ?? [];
}

function diagnosticsOf(source: string) {
  const result = interpret(source);
  expect(result.ok).toBe(false);
  if (result.ok) return [];
  return result.failure.diagnostics;
}

const model = (body: string) => `
model Message {
  id       Int     @id
  text     String
  summary  String
  subtitle String?
  body     String?
${body}
}
`;

describe('@@fullTextIndex', () => {
  it('stores one field as a gin index over that column, with its definition in the options', () => {
    const indexes = indexesOf(model(`  @@fullTextIndex([text], name: "message_text_search")`));

    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({
      columns: ['text'],
      type: 'fullText',
      unique: false,
      prefix: 'message_text_search',
      options: { weightGroups: [['text']], language: 'english' },
    });
    expect(indexes[0]?.expression).toBeUndefined();
  });

  it('accepts a single field without a list', () => {
    expect(indexesOf(model(`  @@fullTextIndex(text, name: "message_text_search")`))).toEqual(
      indexesOf(model(`  @@fullTextIndex([text], name: "message_text_search")`)),
    );
  });

  it('makes each item of a flat list its own weight group', () => {
    const indexes = indexesOf(model(`  @@fullTextIndex([text, body], name: "message_search")`));

    expect(indexes[0]).toMatchObject({
      columns: ['text', 'body'],
      options: { weightGroups: [['text'], ['body']], language: 'english' },
    });
  });

  it('keeps the fields of a nested list in one weight group', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([[text, subtitle], body], name: "message_search")`),
    );

    expect(indexes[0]).toMatchObject({
      columns: ['text', 'subtitle', 'body'],
      options: { weightGroups: [['text', 'subtitle'], ['body']], language: 'english' },
    });
  });

  it('records the language it was given', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([text], language: "german", name: "message_text_search_de")`),
    );

    expect(indexes[0]).toMatchObject({ options: { weightGroups: [['text']], language: 'german' } });
  });

  it('stores the storage column name of a renamed field, not the field name', () => {
    const indexes = indexesOf(`
model Message {
  id    Int    @id
  title String
  text  String @map("body_text")
  @@fullTextIndex([[title, text]], name: "message_text_search")
}
`);

    expect(indexes[0]).toMatchObject({
      columns: ['title', 'body_text'],
      options: { weightGroups: [['title', 'body_text']], language: 'english' },
    });
  });

  it('files one index per declaration, so a model may declare two', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([text], name: "message_text_search")
  @@fullTextIndex([summary], name: "message_summary_search")`),
    );

    expect(indexes.map((index) => index.prefix)).toEqual([
      'message_text_search',
      'message_summary_search',
    ]);
  });

  it('passes a where predicate through to the index', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([text], where: sql\`id > 0\`, name: "message_text_search_live")`),
    );

    expect(indexes[0]).toMatchObject({ columns: ['text'], where: 'id > 0' });
  });

  it('takes map: as the exact database name', () => {
    const indexes = indexesOf(model(`  @@fullTextIndex([text], map: "legacy_text_search")`));

    expect(indexes[0]).toMatchObject({ name: 'legacy_text_search', columns: ['text'] });
    expect(indexes[0]?.prefix).toBeUndefined();
  });

  it('names a different index for a different grouping, order or language', () => {
    const nameOf = (attribute: string) => indexesOf(model(`  ${attribute}`))[0]?.name;

    const names = new Set([
      nameOf(`@@fullTextIndex([[text, body]], name: "s")`),
      nameOf(`@@fullTextIndex([text, body], name: "s")`),
      nameOf(`@@fullTextIndex([body, text], name: "s")`),
      nameOf(`@@fullTextIndex([text, body], language: "german", name: "s")`),
    ]);

    expect(names.size).toBe(4);
  });

  it.each([
    ['"id > 0"', 'Expected sql`...`; write sql`id > 0`'],
    ['42', 'Expected sql`...`'],
    ['true', 'Expected sql`...`'],
  ])('refuses the where value %s at the value', (value, message) => {
    const source = model(
      `  @@fullTextIndex([text], where: ${value}, name: "message_text_search_live")`,
    );
    const line = source.split('\n').findIndex((text) => text.includes('@@fullTextIndex')) + 1;
    const lineText = source.split('\n')[line - 1] ?? '';
    const lineOffset = source.indexOf(lineText);
    const column = lineText.indexOf(value) + 1;

    expect(diagnosticsOf(source)).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message,
        sourceId: 'psl-full-text-index.test.psl',
        span: {
          start: { offset: lineOffset + column - 1, line, column },
          end: {
            offset: lineOffset + column - 1 + value.length,
            line,
            column: column + value.length,
          },
        },
      },
    ]);
  });

  it('rejects a field that is not textual, naming the field and its type', () => {
    const diagnostics = diagnosticsOf(
      model(`  @@fullTextIndex([text, id], name: "message_id_search")`),
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_FULL_TEXT_INDEX_TEXT_FIELD',
          message: expect.stringContaining('Message.id'),
        }),
      ]),
    );
    expect(diagnostics[0]?.message).toContain('pg/int4@1');
  });

  it('rejects a native enum field, which Postgres has no to_tsvector for', () => {
    const diagnostics = diagnosticsOf(`
native_enum Mood {
  happy = "happy"
  sad   = "sad"
}

model Message {
  id   Int          @id
  mood pg.enum(Mood)
  @@fullTextIndex([mood], name: "message_mood_search")
}
`);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_FULL_TEXT_INDEX_TEXT_FIELD',
        message: expect.stringContaining('Message.mood'),
      }),
    ]);
    expect(diagnostics[0]?.message).toContain('pg/enum@1');
  });

  it('rejects a relation field', () => {
    expect(
      diagnosticsOf(`
model Author {
  id       Int       @id
  messages Message[]
}

model Message {
  id       Int    @id
  text     String
  authorId Int
  author   Author @relation(fields: [authorId], references: [id])
  @@fullTextIndex([author], name: "message_author_search")
}
`),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_FULL_TEXT_INDEX_TEXT_FIELD' })]),
    );
  });

  it('rejects a field the model does not declare', () => {
    expect(
      diagnosticsOf(model(`  @@fullTextIndex([[text, missing]], name: "x")`)).length,
    ).toBeGreaterThan(0);
  });

  it('accepts a varchar column, mapped', () => {
    const indexes = indexesOf(`
model Message {
  id      Int     @id
  subject Varchar @map("subject_line")
  @@fullTextIndex([subject], name: "message_subject_search")
}
`);

    expect(indexes[0]).toMatchObject({ columns: ['subject_line'] });
  });

  it('rejects a language Postgres does not ship, naming the ones it does', () => {
    const [diagnostic] = diagnosticsOf(
      model(`  @@fullTextIndex([text], language: "klingon", name: "x")`),
    );

    expect(diagnostic?.message).toContain('"english"');
    expect(diagnostic?.message).toContain('"german"');
  });

  it('rejects more than four weight groups', () => {
    expect(
      diagnosticsOf(model(`  @@fullTextIndex([text, summary, subtitle, body, id], name: "x")`)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS',
          message: expect.stringContaining('at most 4 weight groups'),
        }),
      ]),
    );
  });

  it('rejects an empty weight group, once', () => {
    expect(diagnosticsOf(model(`  @@fullTextIndex([text, []], name: "x")`))).toEqual([
      expect.objectContaining({
        code: 'PSL_FULL_TEXT_INDEX_EMPTY_GROUP',
        message: expect.stringContaining('empty weight group'),
      }),
    ]);
  });

  it('rejects an empty field list as invalid syntax', () => {
    expect(diagnosticsOf(model(`  @@fullTextIndex([], name: "x")`))).toEqual([
      expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' }),
    ]);
  });

  it('rejects a field named twice, in one group or across groups', () => {
    for (const fields of ['[[text, text]]', '[[text, body], text]']) {
      expect(diagnosticsOf(model(`  @@fullTextIndex(${fields}, name: "x")`))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD',
            message: expect.stringContaining('"text"'),
          }),
        ]),
      );
    }
  });

  it('requires a name or a map', () => {
    expect(diagnosticsOf(model('  @@fullTextIndex([text])'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_FULL_TEXT_INDEX_REQUIRES_NAME',
          message: expect.stringContaining('`name` or `map`'),
        }),
      ]),
    );
  });

  it('takes at most one of name and map', () => {
    expect(diagnosticsOf(model(`  @@fullTextIndex([text], name: "a", map: "b")`))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_FULL_TEXT_INDEX_NAME_XOR_MAP',
          message: expect.stringContaining('at most one of `name` and `map`'),
        }),
      ]),
    );
  });
});

describe('@@fullTextIndex with map:', () => {
  const exactNameWarnings = () =>
    vi
      .mocked(process.emitWarning)
      .mock.calls.filter(
        ([, options]) =>
          (options as { code?: string } | undefined)?.code === 'PN_EXACT_NAME_BODY_COMPARISON',
      );

  beforeEach(() => {
    vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns that db verify compares the expression text exactly', () => {
    indexesOf(model(`  @@fullTextIndex([text], map: "legacy_text_search")`));

    expect(exactNameWarnings()).toEqual([
      [expect.stringContaining('index "legacy_text_search"'), expect.anything()],
    ]);
  });

  it('warns once when the index also has a where predicate', () => {
    indexesOf(model(`  @@fullTextIndex([text], where: "id > 0", map: "legacy_text_search_live")`));

    expect(exactNameWarnings()).toHaveLength(1);
  });

  it('does not warn for a wire-named index', () => {
    indexesOf(model(`  @@fullTextIndex([text], name: "message_text_search")`));

    expect(exactNameWarnings()).toEqual([]);
  });
});

describe('a relation whose column a full-text index covers', () => {
  it('still gets its own backing index, which the foreign key names', () => {
    const result = interpret(`
model Author {
  handle   String    @id
  messages Message[]
}

model Message {
  id           Int    @id
  authorHandle String
  author       Author @relation(fields: [authorHandle], references: [handle])
  @@fullTextIndex([authorHandle], name: "message_author_search")
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = (result.value.storage.namespaces['public'] as PostgresSchema).table['Message'];
    expect({ indexes: table?.indexes, index: table?.foreignKeys[0]?.index }).toEqual({
      indexes: [
        {
          columns: ['authorHandle'],
          name: 'message_author_search_8b1b77f7',
          prefix: 'message_author_search',
          type: 'fullText',
          options: { weightGroups: [['authorHandle']], language: 'english' },
          unique: false,
        },
        {
          columns: ['authorHandle'],
          name: 'Message_authorHandle_idx_fbae88d6',
          prefix: 'Message_authorHandle_idx',
          unique: false,
        },
      ],
      index: { name: 'Message_authorHandle_idx_fbae88d6' },
    });
  });

  it('refuses the full-text index named as the foreign key index, at the relation', () => {
    const diagnostics = diagnosticsOf(`
model Author {
  handle   String    @id
  messages Message[]
}

model Message {
  id           Int    @id
  authorHandle String
  author       Author @relation(fields: [authorHandle], references: [handle], index: "message_author_search")
  @@fullTextIndex([authorHandle], name: "message_author_search")
}
`);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_RELATION_ATTRIBUTE',
        message: expect.stringMatching(
          /names "message_author_search" as its index, but it is a "fullText" index, a "gin" index whose key is rendered from its options rather than its columns, so it does not serve the foreign key's lookups\. .*drop the index argument/,
        ),
        span: expect.objectContaining({ start: expect.objectContaining({ line: 10 }) }),
      }),
    ]);
  });

  it('accepts a gin index named as the foreign key index, as the relation claims', () => {
    const result = interpret(`
model Author {
  handle   String    @id
  messages Message[]
}

model Message {
  id           Int    @id
  authorHandle String
  author       Author @relation(fields: [authorHandle], references: [handle], index: "message_author_gin")
  @@index([authorHandle], type: "gin", name: "message_author_gin")
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = (result.value.storage.namespaces['public'] as PostgresSchema).table['Message'];
    expect(table?.foreignKeys[0]?.index).toEqual({ name: table?.indexes[0]?.name });
  });
});
