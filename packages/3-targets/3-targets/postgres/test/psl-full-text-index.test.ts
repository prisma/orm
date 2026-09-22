/**
 * `@@fullTextIndex` renders the same expression the full-text operations
 * lower to, so neither is hand-written. Passing a different language to each
 * still leaves the index unused; only the rendering is shared. It is the documented
 * way to index a text column; `@@index(expression:)` stays available for
 * anything this attribute does not cover.
 */
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from '../src/core/authoring';
import { postgresIndexTypes } from '../src/core/index-types';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

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

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  // The family's varchar codec, to prove the attribute accepts every `textual`
  // codec rather than `pg/text@1` alone.
  ['Varchar', { codecId: 'sql/varchar@1', nativeType: 'character varying' }],
]);

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-full-text-index.test.psl');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);

  return interpretPslDocumentToSqlContract({
    document,
    symbolTable,
    sources,
    target: postgresTarget,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
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
  id      Int    @id
  text    String
  summary String
${body}
}
`;

describe('@@fullTextIndex', () => {
  it('produces the index the equivalent @@index(expression:) produces', () => {
    const typed = indexesOf(model(`  @@fullTextIndex([text], name: "message_text_search")`));
    const authored = indexesOf(
      model(
        `  @@index(expression: "to_tsvector('english', \\"text\\")", type: "gin", name: "message_text_search")`,
      ),
    );

    expect(typed).toEqual(authored);
    expect(typed).toHaveLength(1);
    expect(typed[0]).toMatchObject({
      expression: `to_tsvector('english', "text")`,
      type: 'gin',
      prefix: 'message_text_search',
    });
  });

  it('renders the language it was given', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([text], language: "german", name: "message_text_search_de")`),
    );

    expect(indexes[0]).toMatchObject({ expression: `to_tsvector('german', "text")` });
  });

  it('renders the storage column name of a renamed field, not the field name', () => {
    const indexes = indexesOf(`
model Message {
  id   Int    @id
  text String @map("body_text")
  @@fullTextIndex([text], name: "message_text_search")
}
`);

    expect(indexes[0]).toMatchObject({ expression: `to_tsvector('english', "body_text")` });
  });

  it('files one index per declaration, so a model may search two columns', () => {
    const indexes = indexesOf(
      model(`  @@fullTextIndex([text], name: "message_text_search")
  @@fullTextIndex([summary], name: "message_summary_search")`),
    );

    expect(indexes.map((index) => index.prefix)).toEqual([
      'message_text_search',
      'message_summary_search',
    ]);
  });

  it('passes a where predicate through to the index, like @@index(expression:, where:)', () => {
    const typed = indexesOf(
      model(`  @@fullTextIndex([text], where: "id > 0", name: "message_text_search_live")`),
    );
    const authored = indexesOf(
      model(
        `  @@index(expression: "to_tsvector('english', \\"text\\")", type: "gin", where: "id > 0", name: "message_text_search_live")`,
      ),
    );

    expect(typed).toEqual(authored);
    expect(typed[0]).toMatchObject({ where: 'id > 0' });
  });

  it('rejects a field that is not textual, naming the field and its type', () => {
    const diagnostics = diagnosticsOf(model(`  @@fullTextIndex([id], name: "message_id_search")`));

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

  it('accepts a varchar column, mapped', () => {
    const indexes = indexesOf(`
model Message {
  id      Int     @id
  subject Varchar @map("subject_line")
  @@fullTextIndex([subject], name: "message_subject_search")
}
`);

    expect(indexes[0]).toMatchObject({
      expression: `to_tsvector('english', "subject_line")`,
    });
  });

  it('rejects a language Postgres does not ship, naming the ones it does', () => {
    const [diagnostic] = diagnosticsOf(
      model(`  @@fullTextIndex([text], language: "klingon", name: "x")`),
    );

    expect(diagnostic?.message).toContain('"english"');
    expect(diagnostic?.message).toContain('"german"');
  });

  it('rejects more than one field', () => {
    expect(diagnosticsOf(model(`  @@fullTextIndex([text, summary], name: "x")`))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_FULL_TEXT_INDEX_ONE_FIELD',
          message: expect.stringContaining('one column'),
        }),
      ]),
    );
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
