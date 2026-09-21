/**
 * `fullTextIndex(cols.x, { name })` is the TypeScript twin of
 * `@@fullTextIndex([x], name: …)`. Both render the expression the full-text
 * operations lower to, from the resolved storage column, so the two surfaces
 * produce the same index for the same model.
 */
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import postgresTargetControl from '@internal/target-postgres/control';
import type { PostgresSchema } from '@internal/target-postgres/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { defineContract, field, fullTextIndex, model } from '../../src/exports/contract-builder';

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
  const { document, sourceFile } = parse(PSL);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const result = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    capabilities: {},
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      capabilities: {},
      defaultNamespaceId: 'public',
      indexTypes: postgresTargetControl.indexTypes,
    },
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
  const namespace = result.value.storage.namespaces['public'] as PostgresSchema;
  return namespace.table['message']?.indexes ?? [];
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
  const namespace = contract.storage.namespaces['public'] as PostgresSchema;
  return namespace.table['message']?.indexes ?? [];
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
    const namespace = contract.storage.namespaces['public'] as PostgresSchema;
    expect(namespace.table['message']?.indexes[0]).toMatchObject({
      expression: `to_tsvector('german', "text")`,
    });
  });
});
