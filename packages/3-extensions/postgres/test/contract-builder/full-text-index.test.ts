/**
 * `fullTextIndex(...)` is the TypeScript twin of `@@fullTextIndex(...)`. Both store a `fullText` index whose options hold the weight groups, as storage column names, and the language, so the two surfaces produce the same index for the same model.
 */

import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { sql } from '@internal/sql-contract/sql-expression';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import postgresTargetControl from '@internal/target-postgres/control';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defineContract,
  field,
  fullTextIndex,
  model,
  nativeEnum,
  pg,
  rel,
} from '../../src/exports/contract-builder';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);
const postgresCodecLookup = createPostgresBuiltinCodecLookup();

/**
 * Both surfaces file the index onto the namespace's `message` table; the two
 * namespace values have different static types, so this reads the one shape
 * both share.
 */
function indexesOfPublicMessage(namespace: unknown): readonly Record<string, unknown>[] {
  const table = blindCast<
    { readonly table?: Record<string, { readonly indexes?: readonly Record<string, unknown>[] }> },
    'both the PSL and the TS build produce a Postgres namespace; only its indexes are read here'
  >(namespace).table;
  return table?.['message']?.indexes ?? [];
}

const intColumn = { codecId: 'pg/int4@1' } as const;
const textColumn = { codecId: 'pg/text@1' } as const;

const PSL = `
model Message {
  id       Int     @id
  title    String
  subtitle String?
  text     String? @map("body_text")

  @@fullTextIndex([text], name: "message_text_search")
  @@fullTextIndex([[title, subtitle], text], name: "message_search")
  @@map("message")
}
`;

// The real target descriptor, so the attribute surface under test is the one
// a composed stack actually gets.
const assembled = assembleAuthoringContributions([postgresTargetControl]);

const scalarColumnDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1' }],
  ['String', { codecId: 'pg/text@1' }],
]);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarColumnDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

function pslIndexes() {
  const bound = bindPslSchema(PSL, {
    sourceId: 'full-text-index.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: postgresCodecLookup,
      dataTypes: { entries: assembled.dataTypes, lookup: postgresDataTypeLookup },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      resolvedInputs: [],
      capabilities: {},
    },
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return [];
  return indexesOfPublicMessage(result.value.storage.namespaces['public']);
}

const messageFields = {
  id: field.column(intColumn).id(),
  title: field.column(textColumn),
  subtitle: field.column(textColumn).optional(),
  text: field.column(textColumn).column('body_text').optional(),
  views: field.column(intColumn),
};

type MessageColumns = { readonly [K in keyof typeof messageFields]: ColumnRef<K> };

function indexesOf(indexes: (cols: MessageColumns) => readonly IndexConstraint[]) {
  const contract = defineContract({
    models: {
      Message: model('Message', { fields: messageFields }).sql(({ cols }) => ({
        table: 'message',
        indexes: indexes(cols),
      })),
    },
  });
  return indexesOfPublicMessage(contract.storage.namespaces['public']);
}

describe('fullTextIndex, the TypeScript twin of @@fullTextIndex', () => {
  it('stores one field as a fullText index whose options name its storage column', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex(cols.text, { name: 'message_text_search' }),
    ]);

    expect(index).toMatchObject({
      columns: ['body_text'],
      type: 'fullText',
      prefix: 'message_text_search',
      options: { weightGroups: [['body_text']], language: 'english' },
    });
    expect(index?.['expression']).toBeUndefined();
  });

  it('keeps the fields of a nested list in one weight group', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex([[cols.title, cols.subtitle], cols.text], { name: 'message_search' }),
    ]);

    expect(index).toMatchObject({
      columns: ['title', 'subtitle', 'body_text'],
      options: { weightGroups: [['title', 'subtitle'], ['body_text']], language: 'english' },
    });
  });

  it('makes each item of a flat list its own weight group', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex([cols.title, cols.text], { name: 'message_search' }),
    ]);

    expect(index).toMatchObject({ options: { weightGroups: [['title'], ['body_text']] } });
  });

  it('produces the indexes the PSL attribute produces for the same model', () => {
    expect(
      indexesOf((cols) => [
        fullTextIndex([cols.text], { name: 'message_text_search' }),
        fullTextIndex([[cols.title, cols.subtitle], cols.text], { name: 'message_search' }),
      ]),
    ).toEqual(pslIndexes());
  });

  it('records a non-default language', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex(cols.title, { language: 'german', name: 'message_de' }),
    ]);

    expect(index).toMatchObject({ options: { weightGroups: [['title']], language: 'german' } });
  });

  it('passes a where predicate through to a partial index', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex(cols.title, { where: sql`id > 0`, name: 'message_title_search_live' }),
    ]);

    expect(index).toMatchObject({ where: 'id > 0', columns: ['title'] });
  });

  it('takes map: as the exact database name', () => {
    const [index] = indexesOf((cols) => [fullTextIndex(cols.title, { map: 'legacy_search' })]);

    expect(index).toMatchObject({ name: 'legacy_search', columns: ['title'] });
    expect(index?.['prefix']).toBeUndefined();
  });

  describe('with map:', () => {
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

    it('warns that db verify compares the search document text exactly, as @@fullTextIndex does', () => {
      indexesOf((cols) => [fullTextIndex(cols.title, { map: 'legacy_search' })]);

      expect(exactNameWarnings()).toEqual([
        [expect.stringContaining('index "legacy_search"'), expect.anything()],
      ]);
    });

    it('warns once when the index also has a where predicate', () => {
      indexesOf((cols) => [fullTextIndex(cols.title, { where: sql`id > 0`, map: 'legacy_live' })]);

      expect(exactNameWarnings()).toHaveLength(1);
    });

    it('does not warn for a wire-named index', () => {
      indexesOf((cols) => [fullTextIndex(cols.title, { name: 'message_title_search' })]);

      expect(exactNameWarnings()).toEqual([]);
    });
  });

  it('refuses a string where from an untyped caller, naming the index', () => {
    const untypedFullTextIndex = fullTextIndex as (fields: unknown, options: unknown) => never;
    const what = 'Full-text index "message_title_search_live" where';
    expect(() =>
      indexesOf((cols) => [
        untypedFullTextIndex(cols.title, { where: 'id > 0', name: 'message_title_search_live' }),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `${what} must be a sql\`...\` value.`,
        meta: { what },
      }),
    );
  });

  it('refuses a string where from an untyped caller with no name or map, naming the field', () => {
    const untypedFullTextIndex = fullTextIndex as (fields: unknown, options: unknown) => never;
    const what = 'Full-text index on fields "title" where';
    expect(() =>
      indexesOf((cols) => [untypedFullTextIndex(cols.title, { where: 'id > 0' })]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `${what} must be a sql\`...\` value.`,
        meta: { what },
      }),
    );
  });

  it('refuses a string where from an untyped caller with no name or map, naming every field', () => {
    const untypedFullTextIndex = fullTextIndex as (fields: unknown, options: unknown) => never;
    const what = 'Full-text index on fields "title", "subtitle", "text" where';
    expect(() =>
      indexesOf((cols) => [
        untypedFullTextIndex([[cols.title, cols.subtitle], cols.text], { where: 'id > 0' }),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `${what} must be a sql\`...\` value.`,
        meta: { what },
      }),
    );
  });

  it('refuses a column that is not stored through a textual codec, naming the field and its codec', () => {
    expect(() =>
      indexesOf((cols) => [fullTextIndex([cols.title, cols.views], { name: 'message_search' })]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringMatching(/views.*pg\/int4@1/),
      }),
    );
  });

  it('refuses a native enum column, which Postgres has no to_tsvector for', () => {
    const Mood = nativeEnum('Mood', 'happy', 'sad');

    expect(() =>
      defineContract({
        models: {
          Message: model('Message', {
            fields: { id: field.column(intColumn).id(), mood: field.column(pg.enum(Mood)) },
          }).sql(({ cols }) => ({
            table: 'message',
            indexes: [fullTextIndex(cols.mood, { name: 'message_mood_search' })],
          })),
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('pg/enum@1'),
      }),
    );
  });

  it('refuses a fullText index whose columns are not the fields of its weight groups', () => {
    expect(() =>
      indexesOf(() => [
        {
          kind: 'index',
          fields: ['title'],
          type: 'fullText',
          options: { weightGroups: [['body_text']], language: 'english' },
          name: 'message_search',
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('[title]'),
      }),
    );
  });

  it('refuses a unique fullText index written through the general index API', () => {
    expect(() =>
      indexesOf(() => [
        {
          kind: 'index',
          fields: ['title'],
          type: 'fullText',
          options: { weightGroups: [['title']], language: 'english' },
          unique: true,
          name: 'message_search',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
  });

  it('refuses a fullText index over a column that is not text, written through the general index API', () => {
    expect(() =>
      indexesOf(() => [
        {
          kind: 'index',
          fields: ['title', 'views'],
          type: 'fullText',
          options: { weightGroups: [['title'], ['views']], language: 'english' },
          name: 'message_search',
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringMatching(/views.*pg\/int4@1/),
      }),
    );
  });

  it('refuses a fullText index named as the foreign key index of a relation', () => {
    const Author = model('Author', { fields: { handle: field.column(textColumn).id() } }).sql({
      table: 'author',
    });
    const Message = model('Message', {
      fields: { id: field.column(intColumn).id(), authorHandle: field.column(textColumn) },
      relations: { author: rel.belongsTo(Author, { from: 'authorHandle', to: 'handle' }) },
    }).sql(({ cols, constraints }) => ({
      table: 'message',
      indexes: [fullTextIndex(cols.authorHandle, { name: 'message_author_search' })],
      foreignKeys: [
        constraints.foreignKey(cols.authorHandle, Author.refs.handle, {
          index: 'message_author_search',
        }),
      ],
    }));

    expect(() => defineContract({ models: { Author, Message } })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining(
          'but it is a "fullText" index, a "gin" index whose key is rendered from its options rather than its columns',
        ),
      }),
    );
  });

  it('refuses a field the model does not declare', () => {
    const missing: ColumnRef<'missing'> = { kind: 'columnRef', fieldName: 'missing' };

    expect(() =>
      indexesOf((cols) => [fullTextIndex([cols.title, missing], { name: 'message_search' })]),
    ).toThrow(/missing/);
  });

  it.each([
    [
      'more than four weight groups',
      (cols: MessageColumns) =>
        fullTextIndex([cols.id, cols.title, cols.subtitle, cols.text, cols.views], { name: 'x' }),
      'at most 4 weight groups',
    ],
    [
      'an empty weight group',
      (cols: MessageColumns) => fullTextIndex([cols.title, []], { name: 'x' }),
      'empty weight group',
    ],
    ['no field at all', () => fullTextIndex([], { name: 'x' }), 'at least one field'],
    [
      'a field named twice',
      (cols: MessageColumns) => fullTextIndex([[cols.title, cols.text], cols.title], { name: 'x' }),
      '"title" more than once',
    ],
  ])('refuses %s when it is called', (_label, build, message) => {
    expect(() => build(messageColumnRefs)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining(message),
      }),
    );
  });
});

const messageColumnRefs: MessageColumns = {
  id: { kind: 'columnRef', fieldName: 'id' },
  title: { kind: 'columnRef', fieldName: 'title' },
  subtitle: { kind: 'columnRef', fieldName: 'subtitle' },
  text: { kind: 'columnRef', fieldName: 'text' },
  views: { kind: 'columnRef', fieldName: 'views' },
};
