/**
 * `fullTextIndex(cols.x, { name })` is the TypeScript twin of
 * `@@fullTextIndex([x], name: …)`. Both render the expression the full-text
 * operations lower to, from the resolved storage column, so the two surfaces
 * produce the same index for the same model.
 */
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import postgresTargetControl from '@internal/target-postgres/control';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  renderFullTextIndexExpression,
} from '@internal/target-postgres/sql-utils';
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
function indexesOfPublicMessage(
  namespace: unknown,
): readonly { expression?: string; where?: string }[] {
  const table = blindCast<
    {
      readonly table?: Record<
        string,
        { readonly indexes?: readonly { expression?: string; where?: string }[] }
      >;
    },
    'both the PSL and the TS build produce a Postgres namespace; only its indexes are read here'
  >(namespace).table;
  return table?.['message']?.indexes ?? [];
}

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const PSL = `
model Message {
  id   Int    @id
  text String @map("body_text")

  @@fullTextIndex([text], name: "message_text_search")
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
    pslBlockDescriptors: assembled.pslBlockDescriptors,
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

function tsIndexes() {
  const contract = defineContract({
    models: {
      Message: model('Message', {
        fields: {
          id: field.column(intColumn).id(),
          text: field.column(textColumn).column('body_text'),
        },
      }).sql(({ cols }) => ({
        table: 'message',
        indexes: [fullTextIndex(cols.text, { name: 'message_text_search' })],
      })),
    },
  });
  return indexesOfPublicMessage(contract.storage.namespaces['public']);
}

describe('fullTextIndex, the TypeScript twin of @@fullTextIndex', () => {
  it('renders the storage column name, not the field name', () => {
    expect(tsIndexes()[0]).toMatchObject({
      expression: `to_tsvector('english', "body_text")`,
      type: 'gin',
      prefix: 'message_text_search',
    });
  });

  it('produces the index the PSL attribute produces for the same model', () => {
    expect(tsIndexes()).toEqual(pslIndexes());
  });

  it('defaults to the language the target declares, not a copy of it', () => {
    expect(tsIndexes()[0]?.expression).toBe(
      renderFullTextIndexExpression(DEFAULT_FULL_TEXT_SEARCH_LANGUAGE, 'body_text'),
    );
  });

  it('passes a where predicate through to a partial index', () => {
    const contract = defineContract({
      models: {
        Message: model('Message', {
          fields: { id: field.column(intColumn).id(), text: field.column(textColumn) },
        }).sql(({ cols }) => ({
          table: 'message',
          indexes: [
            fullTextIndex(cols.text, { where: 'id > 0', name: 'message_text_search_live' }),
          ],
        })),
      },
    });

    expect(indexesOfPublicMessage(contract.storage.namespaces['public'])[0]).toMatchObject({
      where: 'id > 0',
    });
  });

  it('refuses a column that is not stored through a textual codec', () => {
    expect(() =>
      defineContract({
        models: {
          Message: model('Message', {
            fields: { id: field.column(intColumn).id(), views: field.column(intColumn) },
          }).sql(({ cols }) => ({
            table: 'message',
            indexes: [fullTextIndex(cols.views, { name: 'message_views_search' })],
          })),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
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

  it('names the field and its codec when it refuses one', () => {
    expect(() =>
      defineContract({
        models: {
          Message: model('Message', {
            fields: { id: field.column(intColumn).id(), views: field.column(intColumn) },
          }).sql(({ cols }) => ({
            table: 'message',
            indexes: [fullTextIndex(cols.views, { name: 'message_views_search' })],
          })),
        },
      }),
    ).toThrow(/views.*pg\/int4@1/);
  });

  it('renders a non-default language', () => {
    const contract = defineContract({
      models: {
        Message: model('Message', {
          fields: { id: field.column(intColumn).id(), text: field.column(textColumn) },
        }).sql(({ cols }) => ({
          table: 'message',
          indexes: [fullTextIndex(cols.text, { language: 'german', name: 'message_de' })],
        })),
      },
    });
    expect(indexesOfPublicMessage(contract.storage.namespaces['public'])[0]).toMatchObject({
      expression: `to_tsvector('german', "text")`,
    });
  });
});
