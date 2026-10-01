/**
 * `fullTextIndex(...)` is the TypeScript twin of `@@fullTextIndex(...)`. Both
 * store the index as a gin index whose options hold the weight groups, as
 * storage column names, and the language, so the two surfaces produce the
 * same index for the same model.
 */
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import postgresTargetControl from '@internal/target-postgres/control';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  fullTextIndex,
  model,
  nativeEnum,
  pg,
} from '../../src/exports/contract-builder';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

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

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

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

function pslIndexes() {
  const { document, sources } = parse(PSL, 'full-text-index.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
  });
  const result = interpretPslDocumentToSqlContract({
    documents: [document],
    symbolTable,
    sources,
    capabilities: {},
    target: postgresPack,
    dataTypeLookup: postgresDataTypeLookup,
    scalarColumnDescriptors: new Map([
      ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
      ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
    ]),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
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
      options: { fields: [['body_text']], language: 'english' },
    });
    expect(index?.['expression']).toBeUndefined();
  });

  it('keeps the fields of a nested list in one weight group', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex([[cols.title, cols.subtitle], cols.text], { name: 'message_search' }),
    ]);

    expect(index).toMatchObject({
      columns: ['title', 'subtitle', 'body_text'],
      options: { fields: [['title', 'subtitle'], ['body_text']], language: 'english' },
    });
  });

  it('makes each item of a flat list its own weight group', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex([cols.title, cols.text], { name: 'message_search' }),
    ]);

    expect(index).toMatchObject({ options: { fields: [['title'], ['body_text']] } });
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

    expect(index).toMatchObject({ options: { fields: [['title']], language: 'german' } });
  });

  it('passes a where predicate through to a partial index', () => {
    const [index] = indexesOf((cols) => [
      fullTextIndex(cols.title, { where: 'id > 0', name: 'message_title_search_live' }),
    ]);

    expect(index).toMatchObject({ where: 'id > 0', columns: ['title'] });
  });

  it('takes map: as the exact database name', () => {
    const [index] = indexesOf((cols) => [fullTextIndex(cols.title, { map: 'legacy_search' })]);

    expect(index).toMatchObject({ name: 'legacy_search', columns: ['title'] });
    expect(index?.['prefix']).toBeUndefined();
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
          options: { fields: [['body_text']], language: 'english' },
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
          options: { fields: [['title']], language: 'english' },
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
          options: { fields: [['title'], ['views']], language: 'english' },
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
